// Migration for the event/station query indexes. Safe to run more than once.
//
//   1. Backfills the GeoJSON `location` point on events (from latitude_value/longitude_value)
//      and devices (from latitude/longitude). Records with missing or out-of-range coordinates
//      are left without a location, since a 2dsphere index can't hold an invalid point.
//   2. Builds the indexes defined in events.model.js and device.model.js (OT, 2dsphere, ...)
//      and jobLock.model.js (TTL on expiresAt), replacing any index whose options changed.
//      Indexes not in the schema are listed before anything is dropped.
//   3. Checks that the event list, enrichment job and location queries use those indexes.
//
//   dry run (no changes): docker exec -w /app earthquake-hub-backend-dev node scripts/migrate-event-indexes.js --dry-run
//   apply:                docker exec -w /app earthquake-hub-backend-dev node scripts/migrate-event-indexes.js
//   on a server:          docker exec ehub-backend node scripts/migrate-event-indexes.js [--dry-run]
//
// Exit code: 0 = done (or dry run), 1 = a query isn't using an index, 2 = error.
const mongoose = require('mongoose');
// Must be set before the models load, or Mongoose builds their indexes on connect (even in a dry run).
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);
const { connectOrThrow } = require('./find-duplicates');
const { planStages, usesIndex } = require('./lib/query-plan');
const Event = require('../src/models/events.model');
const Device = require('../src/models/device.model');
// joblocks: an older plain expiresAt_1 index blocked the TTL index of the same name.
const JobLock = require('../src/models/jobLock.model');

const dryRun = process.argv.includes('--dry-run');

// Same rules as toGeoPoint() in src/models/geoPoint.js, expressed as query filters.
const validCoordinates = (latField, lonField) => ({
  [latField]: { $type: 'number', $gte: -90, $lte: 90 },
  [lonField]: { $type: 'number', $gte: -180, $lte: 180 },
});

// Sets `location` where it's missing or out of date, and removes it where the coordinates are invalid.
async function backfillLocation(collection, latField, lonField) {
  const valid = validCoordinates(latField, lonField);
  const needsSet = {
    ...valid,
    $expr: { $ne: ['$location.coordinates', [`$${lonField}`, `$${latField}`]] },
  };
  const needsUnset = { location: { $exists: true }, $nor: [valid] };

  const toSet = await collection.countDocuments(needsSet);
  const toUnset = await collection.countDocuments(needsUnset);
  const invalid = await collection.countDocuments({ $nor: [valid] });
  console.log(`${collection.collectionName}: set location ${toSet}, remove invalid location ${toUnset}, `
    + `records without valid coordinates ${invalid}`);

  if (!dryRun) {
    if (toSet) {
      await collection.updateMany(needsSet, [
        { $set: { location: { type: 'Point', coordinates: [`$${lonField}`, `$${latField}`] } } },
      ]);
    }
    if (toUnset) await collection.updateMany(needsUnset, { $unset: { location: '' } });
  }
}

async function main() {
  const db = await connectOrThrow();
  const events = db.collection('events');
  const devices = db.collection('devices');
  console.log(`\n# Event/station index migration on "${db.databaseName}"${dryRun ? ' (DRY RUN: no changes)' : ''}`);
  console.log(`events: ${await events.countDocuments()}  devices: ${await devices.countDocuments()}`);

  // ---------- 1. location backfill ----------
  console.log('\n# Location backfill');
  await backfillLocation(events, 'latitude_value', 'longitude_value');
  await backfillLocation(devices, 'latitude', 'longitude');

  // ---------- 2. indexes ----------
  // Built after the backfill so the 2dsphere indexes only ever see valid points.
  console.log('\n# Indexes');
  for (const Model of [Event, Device, JobLock]) {
    const diff = await Model.diffIndexes();
    const toCreate = diff.toCreate.map((spec) => JSON.stringify(spec));
    console.log(`${Model.collection.name}: create ${toCreate.length ? toCreate.join(', ') : 'none'}; `
      + `drop ${diff.toDrop.length ? diff.toDrop.join(', ') : 'none'}`);
    if (!dryRun && (diff.toCreate.length || diff.toDrop.length)) {
      await Model.syncIndexes();
    }
  }

  if (dryRun) {
    console.log('\nDry run finished. Run without --dry-run to apply.');
    return 0;
  }

  // ---------- 3. verify ----------
  console.log('\n# Index usage check');
  const now = new Date();
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const manila = { type: 'Point', coordinates: [121.0, 14.6] };
  const near = { location: { $near: { $geometry: manila, $maxDistance: 200000 } } };
  const checks = [
    ['event list (OT range, newest first)', events, { OT: { $gte: monthAgo, $lte: now } }, { OT: -1 }],
    ['event list (OT range, unsorted)', events, { OT: { $gte: monthAgo, $lte: now } }, undefined],
    ['enrichment job (OT <= cutoff, oldest first)', events, { OT: { $lte: now } }, { OT: 1 }],
    ['event detail by publicID', events, { publicID: 'check' }, undefined],
    ['events near a point', events, near, undefined],
    ['nearest active stations', devices, { ...near, activity: 'active' }, undefined],
  ];
  let failed = 0;
  for (const [label, collection, filter, sort] of checks) {
    const stages = await planStages(collection, filter, { sort });
    const ok = usesIndex(stages);
    if (!ok) failed += 1;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}: ${stages.join(' <- ')}`);
  }

  console.log(failed ? `\n${failed} query(ies) are not using an index.` : '\nMigration complete.');
  return failed ? 1 : 0;
}

main()
  .then(async (code) => { await mongoose.disconnect(); process.exit(code); })
  .catch(async (err) => {
    console.error(`migrate-event-indexes failed: ${err.message}`);
    await mongoose.disconnect().catch(() => {});
    process.exit(2);
  });
