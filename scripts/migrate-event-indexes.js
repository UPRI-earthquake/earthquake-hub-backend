// Migration for the `events` query indexes. Safe to run more than once.
//
//   1. Builds the indexes defined in events.model.js (adds the OT index, and replaces any
//      index whose options changed). Indexes not in the schema are listed before anything is dropped.
//   2. Checks that the event list and the enrichment job queries use the OT index.
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

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const db = await connectOrThrow();
  const events = db.collection('events');
  console.log(`\n# Event index migration on "${db.databaseName}"${dryRun ? ' (DRY RUN: no changes)' : ''}`);
  console.log(`events: ${await events.countDocuments()}`);

  // ---------- 1. indexes ----------
  console.log('\n# Indexes');
  const diff = await Event.diffIndexes();
  console.log(`create: ${diff.toCreate.length ? diff.toCreate.map((spec) => JSON.stringify(spec)).join(', ') : 'none'}`);
  console.log(`drop:   ${diff.toDrop.length ? diff.toDrop.join(', ') : 'none'}`);

  if (dryRun) {
    console.log('\nDry run finished. Run without --dry-run to apply.');
    return 0;
  }
  if (diff.toCreate.length || diff.toDrop.length) {
    await Event.syncIndexes();
    console.log('applied');
  }

  // ---------- 2. verify ----------
  console.log('\n# Index usage check');
  const now = new Date();
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const checks = [
    ['event list (OT range, newest first)', { OT: { $gte: monthAgo, $lte: now } }, { OT: -1 }],
    ['event list (OT range, unsorted)', { OT: { $gte: monthAgo, $lte: now } }, undefined],
    ['enrichment job (OT <= cutoff, oldest first)', { OT: { $lte: now } }, { OT: 1 }],
    ['event detail by publicID', { publicID: 'check' }, undefined],
  ];
  let failed = 0;
  for (const [label, filter, sort] of checks) {
    const stages = await planStages(events, filter, { sort });
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
