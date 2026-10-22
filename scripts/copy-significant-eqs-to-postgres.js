// Copies significant earthquakes from MongoDB (`significant-eqs`) to PostgreSQL (`significant_eqs`).
// Safe to run more than once: rows are matched by legacy_mongo_id (the MongoDB _id).
//
//   1. Reads every MongoDB record and checks it against the table's rules (title, magnitude, latitude,
//      longitude and eventTime present and in range; recordings and references are lists). Records
//      that break a rule are listed with their _id, title and every reason, and skipped: fix them in
//      MongoDB and run again.
//   2. Inserts new rows and updates copied ones, except rows changed in PostgreSQL since they were
//      copied, so re-running after the switch never overwrites newer data.
//   3. Checks that every valid record now has its row, and that the counts add up.
//
//   dry run (no changes): docker exec -w /app earthquake-hub-backend-dev node scripts/copy-significant-eqs-to-postgres.js --dry-run
//   copy:                 docker exec -w /app earthquake-hub-backend-dev node scripts/copy-significant-eqs-to-postgres.js
//
// Run it before setting SIGNIFICANT_EQS_DB=postgres. Old links keep working: the API returns a copied
// row's MongoDB id as `_id`, and looks it up by that id.
// Exit code: 0 = done (or dry run), 1 = validation failed, 2 = error. Skipped records alone don't fail it.
try { require('dotenv/config'); } catch (_) { /* prod images don't ship dotenv; env comes from compose */ }
const mongoose = require('mongoose');
const { toDate, upsertByLegacyId, missingLegacyIds } = require('./lib/pgCopy');

// Columns overwritten when a copied row is refreshed (everything but the ids)
const COPIED_COLUMNS = [
  'title', 'magnitude', 'depth_km', 'latitude', 'longitude', 'location_text', 'event_time', 'event_summary',
  'instrument_recordings', 'reference_links', 'created_at', 'updated_at',
];

// A number, or a numeric string (as Mongoose would have cast it); NaN otherwise
const toNumber = (value) => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return NaN;
};

const isMissing = (value) => value === null || value === undefined || value === '';

// Mirrors the table's NOT NULL and CHECK rules (migration 20261023000000), so problems are reported
// per record instead of failing the whole copy
const RANGES = {
  magnitude: [-2, 10],
  latitude: [-90, 90],
  longitude: [-180, 180],
  depth: [-10, 1000],
};

// Every reason a document can't be stored (empty when it can)
const problemsWith = (doc) => {
  const problems = [];
  if (typeof doc.title !== 'string' || doc.title.trim() === '') problems.push('missing title');

  ['magnitude', 'latitude', 'longitude'].forEach((field) => {
    if (isMissing(doc[field])) {
      problems.push(`missing ${field}`);
      return;
    }
    const value = toNumber(doc[field]);
    const [min, max] = RANGES[field];
    if (!Number.isFinite(value) || value < min || value > max) {
      problems.push(`${field} ${JSON.stringify(doc[field])} not between ${min} and ${max}`);
    }
  });

  if (!isMissing(doc.depth)) {
    const depth = toNumber(doc.depth);
    const [min, max] = RANGES.depth;
    if (!Number.isFinite(depth) || depth < min || depth > max) {
      problems.push(`depth ${JSON.stringify(doc.depth)} not between ${min} and ${max}`);
    }
  }

  if (isMissing(doc.eventTime)) problems.push('missing eventTime');
  else if (!toDate(doc.eventTime)) problems.push(`eventTime ${JSON.stringify(doc.eventTime)} is not a date`);

  if (!isMissing(doc.instrumentRecordings) && !Array.isArray(doc.instrumentRecordings)) {
    problems.push('instrumentRecordings is not a list');
  }
  if (!isMissing(doc.references) && !Array.isArray(doc.references)) problems.push('references is not a list');
  return problems;
};

const toRow = (doc) => {
  // The collection had no timestamps; the ObjectId records when each document was created
  const createdAt = doc._id.getTimestamp();
  return {
    legacy_mongo_id: String(doc._id),
    title: doc.title, // as stored, so the API returns it unchanged
    magnitude: toNumber(doc.magnitude),
    depth_km: isMissing(doc.depth) ? null : toNumber(doc.depth),
    latitude: toNumber(doc.latitude),
    longitude: toNumber(doc.longitude),
    location_text: isMissing(doc.location) ? null : String(doc.location),
    event_time: toDate(doc.eventTime),
    event_summary: isMissing(doc.eventSummary) ? null : String(doc.eventSummary),
    // JSON text: pg would otherwise send a JS array as a PostgreSQL array, not jsonb
    instrument_recordings: JSON.stringify(doc.instrumentRecordings || []),
    reference_links: JSON.stringify(doc.references || []),
    created_at: createdAt,
    updated_at: createdAt,
  };
};

/***************************************************************************
  * copySignificantEqs:
  *     Copies MongoDB significant earthquakes to PostgreSQL (see the steps at the top of this file).
  *     Expects Mongoose to be connected already.
  *
  * Inputs:
  *     db:      Knex instance for PostgreSQL
  *     dryRun:  report what would change without writing
  *     log:     function for progress lines (default console.log)
  *
  * Outputs:
  *     { ok, mongoTotal, problems: [{ id, title, reasons }], inserted, updated, keptNewer, missing: [id] }
  *     In a dry run, inserted/updated/keptNewer are what a real run would do, and missing is empty.
 ***************************************************************************/
async function copySignificantEqs({ db, dryRun = false, log = console.log }) {
  const docs = await mongoose.connection.collection('significant-eqs').find({}).toArray();

  const problems = [];
  const rows = [];
  docs.forEach((doc) => {
    const reasons = problemsWith(doc);
    if (reasons.length > 0) problems.push({ id: String(doc._id), title: doc.title ?? null, reasons });
    else rows.push(toRow(doc));
  });

  const { inserted, updated, keptNewer } = await upsertByLegacyId({
    db, table: 'significant_eqs', rows, columns: COPIED_COLUMNS, dryRun,
  });

  const missing = dryRun ? [] : await missingLegacyIds(db, 'significant_eqs', rows.map((row) => row.legacy_mongo_id));
  const countsAddUp = docs.length === problems.length + rows.length
    && rows.length === inserted + updated + keptNewer;
  const ok = missing.length === 0 && countsAddUp;

  log(`${dryRun ? '[dry run] ' : ''}MongoDB significant earthquakes: ${docs.length}`);
  log(`  ${dryRun ? 'would insert' : 'inserted'}: ${inserted}`);
  log(`  ${dryRun ? 'would update' : 'updated'}: ${updated}`);
  log(`  kept (changed in PostgreSQL since copied): ${keptNewer}`);
  log(`  skipped, breaks the table's rules (fix in MongoDB, then run again): ${problems.length}`);
  problems.forEach(({ id, title, reasons }) => log(`    ${id} ${JSON.stringify(title)}: ${reasons.join('; ')}`));
  if (!dryRun) {
    log(missing.length === 0
      ? `Validation passed: all ${rows.length} valid records are in PostgreSQL.`
      : `Validation FAILED: ${missing.length} valid records have no PostgreSQL row: ${missing.join(', ')}`);
  }
  if (!countsAddUp) log('Validation FAILED: counts do not add up.');

  return { ok, mongoTotal: docs.length, problems, inserted, updated, keptNewer, missing };
}

module.exports = { copySignificantEqs };

if (require.main === module) {
  const { connectOrThrow } = require('./find-duplicates');
  const postgres = require('../src/db/knex');
  const dryRun = process.argv.includes('--dry-run');

  connectOrThrow()
    .then(() => copySignificantEqs({ db: postgres.db, dryRun }))
    .then(async ({ ok }) => {
      await mongoose.disconnect();
      await postgres.db.destroy();
      process.exit(ok ? 0 : 1);
    })
    .catch(async (err) => {
      console.error(`copy-significant-eqs-to-postgres failed: ${err.message}`);
      await mongoose.disconnect().catch(() => {});
      await postgres.db.destroy().catch(() => {});
      process.exit(2);
    });
}
