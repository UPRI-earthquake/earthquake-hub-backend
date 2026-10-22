// Copies push subscriptions from MongoDB (`subscriptions`) to PostgreSQL (`push_subscriptions`).
// Safe to run more than once: rows are matched by legacy_mongo_id (the MongoDB _id).
//
//   1. Reads every MongoDB subscription and checks it can be stored (endpoint and both keys present,
//      known status). Ones that can't are listed by _id and skipped.
//   2. Skips subscriptions whose endpoint already belongs to a different PostgreSQL row (the browser
//      subscribed again after the switch, so PostgreSQL has the newer one).
//   3. Inserts new rows and updates copied ones, except rows changed in PostgreSQL since they were
//      copied (their updated_at is newer), so re-running after the switch never overwrites newer data.
//   4. Checks that every copyable subscription now has its row, and that the counts add up.
//
//   dry run (no changes): docker exec -w /app earthquake-hub-backend-dev node scripts/copy-subscriptions-to-postgres.js --dry-run
//   copy:                 docker exec -w /app earthquake-hub-backend-dev node scripts/copy-subscriptions-to-postgres.js
//
// Run it before setting PUSH_SUBSCRIPTIONS_DB=postgres (and again right before, if time has passed).
// Exit code: 0 = done (or dry run), 1 = validation failed, 2 = error.
try { require('dotenv/config'); } catch (_) { /* prod images don't ship dotenv; env comes from compose */ }
const mongoose = require('mongoose');
const { chunk, toDate, upsertByLegacyId, missingLegacyIds } = require('./lib/pgCopy');

const STATUSES = new Set(['active', 'invalid']);

// Columns overwritten when a copied row is refreshed (everything but the ids)
const COPIED_COLUMNS = [
  'endpoint', 'expiration_time', 'key_auth', 'key_p256dh', 'status', 'last_seen_at', 'last_delivered_at',
  'last_failure_at', 'last_failure_code', 'consecutive_failures', 'invalidated_at', 'cleanup_after',
  'source_sw_script', 'client_user_agent', 'client_app_version', 'client_time', 'created_at', 'updated_at',
];

const toEpochMs = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null;
  const date = toDate(value);
  return date ? date.getTime() : null;
};

const toIntOrNull = (value) => (Number.isInteger(value) ? value : null);

// Why a document can't be stored, or null when it can
const problemWith = (doc) => {
  if (typeof doc.endpoint !== 'string' || !doc.endpoint) return 'no endpoint';
  if (!doc.keys || !doc.keys.auth || !doc.keys.p256dh) return 'missing keys';
  if (doc.status !== undefined && !STATUSES.has(doc.status)) return `unknown status "${doc.status}"`;
  return null;
};

const toRow = (doc) => {
  // Older documents may predate the timestamps; the ObjectId still records when it was created
  const createdAt = toDate(doc.createdAt) || doc._id.getTimestamp();
  return {
    legacy_mongo_id: String(doc._id),
    endpoint: doc.endpoint,
    expiration_time: toEpochMs(doc.expirationTime),
    key_auth: doc.keys.auth,
    key_p256dh: doc.keys.p256dh,
    status: doc.status || 'active',
    last_seen_at: toDate(doc.lastSeenAt) || createdAt,
    last_delivered_at: toDate(doc.lastDeliveredAt),
    last_failure_at: toDate(doc.lastFailureAt),
    last_failure_code: toIntOrNull(doc.lastFailureCode),
    consecutive_failures: Number.isInteger(doc.consecutiveFailures) && doc.consecutiveFailures > 0
      ? doc.consecutiveFailures : 0,
    invalidated_at: toDate(doc.invalidatedAt),
    cleanup_after: toDate(doc.cleanupAfter),
    source_sw_script: doc.sourceSwScript || null,
    client_user_agent: doc.clientMeta?.userAgent ?? null,
    client_app_version: doc.clientMeta?.appVersion ?? null,
    client_time: toDate(doc.clientMeta?.clientTime),
    created_at: createdAt,
    updated_at: toDate(doc.updatedAt) || createdAt,
  };
};

/***************************************************************************
  * copySubscriptions:
  *     Copies MongoDB subscriptions to PostgreSQL (see the steps at the top of this file).
  *     Expects Mongoose to be connected already.
  *
  * Inputs:
  *     db:      Knex instance for PostgreSQL
  *     dryRun:  report what would change without writing
  *     log:     function for progress lines (default console.log)
  *
  * Outputs:
  *     { ok, mongoTotal, problems: [{ id, reason }], conflicts: [id], inserted, updated, keptNewer, missing: [id] }
  *     In a dry run, inserted/updated/keptNewer are what a real run would do, and missing is empty.
 ***************************************************************************/
async function copySubscriptions({ db, dryRun = false, log = console.log }) {
  const docs = await mongoose.connection.collection('subscriptions').find({}).toArray();

  const problems = [];
  const candidates = [];
  docs.forEach((doc) => {
    const reason = problemWith(doc);
    if (reason) problems.push({ id: String(doc._id), reason });
    else candidates.push(toRow(doc));
  });

  // Endpoints PostgreSQL already has under another (or no) legacy id
  const existingByEndpoint = new Map();
  for (const batch of chunk(candidates)) {
    const existing = await db('push_subscriptions')
      .select('endpoint', 'legacy_mongo_id')
      .whereIn('endpoint', batch.map((row) => row.endpoint));
    existing.forEach((row) => existingByEndpoint.set(row.endpoint, row));
  }
  const conflicts = [];
  const rows = candidates.filter((row) => {
    const sameEndpoint = existingByEndpoint.get(row.endpoint);
    const conflict = sameEndpoint && (sameEndpoint.legacy_mongo_id || '').trim() !== row.legacy_mongo_id;
    if (conflict) conflicts.push(row.legacy_mongo_id);
    return !conflict;
  });

  const { inserted, updated, keptNewer } = await upsertByLegacyId({
    db, table: 'push_subscriptions', rows, columns: COPIED_COLUMNS, dryRun,
  });

  // Validation: every copyable subscription has its row, and the counts add up
  const missing = dryRun
    ? []
    : await missingLegacyIds(db, 'push_subscriptions', rows.map((row) => row.legacy_mongo_id));
  const countsAddUp = docs.length === problems.length + conflicts.length + rows.length
    && rows.length === inserted + updated + keptNewer;
  const ok = missing.length === 0 && countsAddUp;

  log(`${dryRun ? '[dry run] ' : ''}MongoDB subscriptions: ${docs.length}`);
  log(`  ${dryRun ? 'would insert' : 'inserted'}: ${inserted}`);
  log(`  ${dryRun ? 'would update' : 'updated'}: ${updated}`);
  log(`  kept (changed in PostgreSQL since copied): ${keptNewer}`);
  log(`  skipped, endpoint already in PostgreSQL under another row: ${conflicts.length}`);
  conflicts.forEach((id) => log(`    ${id}`));
  log(`  skipped, can't be stored: ${problems.length}`);
  problems.forEach(({ id, reason }) => log(`    ${id}: ${reason}`));
  if (!dryRun) {
    log(missing.length === 0
      ? `Validation passed: all ${rows.length} copyable subscriptions are in PostgreSQL.`
      : `Validation FAILED: ${missing.length} copyable subscriptions have no PostgreSQL row: ${missing.join(', ')}`);
  }
  if (!countsAddUp) log('Validation FAILED: counts do not add up.');

  return { ok, mongoTotal: docs.length, problems, conflicts, inserted, updated, keptNewer, missing };
}

module.exports = { copySubscriptions };

if (require.main === module) {
  const { connectOrThrow } = require('./find-duplicates');
  const postgres = require('../src/db/knex');
  const dryRun = process.argv.includes('--dry-run');

  connectOrThrow()
    .then(() => copySubscriptions({ db: postgres.db, dryRun }))
    .then(async ({ ok }) => {
      await mongoose.disconnect();
      await postgres.db.destroy();
      process.exit(ok ? 0 : 1);
    })
    .catch(async (err) => {
      console.error(`copy-subscriptions-to-postgres failed: ${err.message}`);
      await mongoose.disconnect().catch(() => {});
      await postgres.db.destroy().catch(() => {});
      process.exit(2);
    });
}
