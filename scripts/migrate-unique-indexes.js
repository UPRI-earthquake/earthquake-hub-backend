// One-time migration for the account/device uniqueness rules. Safe to run more than once.
//
//   1. Runs the duplicate check (scripts/find-duplicates.js) and stops if anything blocks the indexes.
//   2. Lowercases and trims stored account emails.
//   3. Replaces the legacy "TO_BE_LINKED" placeholder in devices.streamId / devices.macAddress with null.
//   4. Builds the unique indexes defined in account.model.js and device.model.js.
//   5. Checks that login and device lookups use those indexes (IXSCAN, not COLLSCAN).
//
//   dry run (no changes): docker exec -w /app earthquake-hub-backend-dev node scripts/migrate-unique-indexes.js --dry-run
//   apply:                docker exec -w /app earthquake-hub-backend-dev node scripts/migrate-unique-indexes.js
//   on a server:          docker exec ehub-backend node scripts/migrate-unique-indexes.js [--dry-run]
//
// Exit code: 0 = done (or dry run clean), 1 = blocked by duplicates or index check failed, 2 = error.
const mongoose = require('mongoose');
const { checkDuplicates, connectOrThrow } = require('./find-duplicates');
const Account = require('../src/models/account.model');
const Device = require('../src/models/device.model');

const PLACEHOLDER = 'TO_BE_LINKED';
const dryRun = process.argv.includes('--dry-run');

const emailNeedsNormalizing = {
  email: { $type: 'string' },
  $expr: { $ne: ['$email', { $toLower: { $trim: { input: '$email' } } }] },
};

// Returns the winning plan's stages, e.g. ['FETCH', 'IXSCAN'].
async function planStages(collection, filter) {
  const explained = await collection.find(filter).limit(1).explain('queryPlanner');
  const stages = [];
  let stage = explained.queryPlanner.winningPlan;
  // MongoDB 8 may wrap the classic plan in queryPlan
  if (stage.queryPlan) stage = stage.queryPlan;
  while (stage) {
    stages.push(stage.stage);
    stage = stage.inputStage;
  }
  return stages;
}

async function main() {
  const db = await connectOrThrow();
  const accounts = db.collection('accounts');
  const devices = db.collection('devices');
  console.log(`\n# Uniqueness migration on "${db.databaseName}"${dryRun ? ' (DRY RUN: no changes)' : ''}`);

  // ---------- 1. gate ----------
  const blockers = await checkDuplicates(db);
  if (blockers.length > 0) {
    console.log('\nStopped: resolve the blockers above, then run this again. Nothing was changed.');
    return 1;
  }

  // ---------- 2-3. data clean-up ----------
  console.log('\n# Data clean-up');
  const emailCount = await accounts.countDocuments(emailNeedsNormalizing);
  const streamCount = await devices.countDocuments({ streamId: PLACEHOLDER });
  const macCount = await devices.countDocuments({ macAddress: PLACEHOLDER });
  console.log(`emails to lowercase/trim: ${emailCount}`);
  console.log(`"${PLACEHOLDER}" -> null: streamId ${streamCount}, macAddress ${macCount}`);

  if (!dryRun) {
    if (emailCount) {
      await accounts.updateMany(emailNeedsNormalizing, [
        { $set: { email: { $toLower: { $trim: { input: '$email' } } } } },
      ]);
    }
    if (streamCount) await devices.updateMany({ streamId: PLACEHOLDER }, { $set: { streamId: null } });
    if (macCount) await devices.updateMany({ macAddress: PLACEHOLDER }, { $set: { macAddress: null } });
    console.log('applied');
  }

  // ---------- 4. indexes ----------
  console.log('\n# Indexes');
  for (const Model of [Account, Device]) {
    const diff = await Model.diffIndexes();
    const toCreate = diff.toCreate.map((spec) => JSON.stringify(spec));
    const toDrop = diff.toDrop;
    console.log(`${Model.collection.name}: create ${toCreate.length ? toCreate.join(', ') : 'none'}; drop ${toDrop.length ? toDrop.join(', ') : 'none'}`);
    if (!dryRun && (toCreate.length || toDrop.length)) {
      // syncIndexes also replaces an index whose options changed (e.g. non-unique -> unique)
      await Model.syncIndexes();
    }
  }

  if (dryRun) {
    console.log('\nDry run finished: no blockers. Run without --dry-run to apply.');
    return 0;
  }

  // ---------- 5. verify ----------
  console.log('\n# Index usage check');
  const checks = [
    ['account login by email', accounts, { email: 'check@example.com' }],
    ['account login by username', accounts, { username: 'check' }],
    ['device lookup by streamId', devices, { streamId: 'XX_CHECK_.*/MSEED' }],
    ['device lookup by macAddress', devices, { macAddress: '00:00:00:00:00:00' }],
    ['device lookup by network+station', devices, { network: 'XX', station: 'CHECK' }],
  ];
  let failed = 0;
  for (const [label, collection, filter] of checks) {
    const stages = await planStages(collection, filter);
    const ok = stages.includes('IXSCAN') || stages.includes('EXPRESS_IXSCAN') || stages.includes('IDHACK');
    if (!ok) failed += 1;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}: ${stages.join(' <- ')}`);
  }

  console.log(failed ? `\n${failed} lookup(s) are not using an index.` : '\nMigration complete.');
  return failed ? 1 : 0;
}

main()
  .then(async (code) => { await mongoose.disconnect(); process.exit(code); })
  .catch(async (err) => {
    console.error(`migrate-unique-indexes failed: ${err.message}`);
    await mongoose.disconnect().catch(() => {});
    process.exit(2);
  });
