// Read-only report of records that would block the unique indexes planned for
// `accounts` (email, username) and `devices` (streamId, macAddress, network+station).
// Run it right before adding those indexes; it never modifies data.
//
//   local:  docker exec -w /app earthquake-hub-backend-dev node scripts/find-duplicates.js
//   server: docker exec ehub-backend node scripts/find-duplicates.js
//
// Exit code: 0 = no blockers, 1 = blockers found (resolve them first), 2 = error.
// The report prints account emails and usernames; don't paste it into public channels.
try { require('dotenv/config'); } catch (_) { /* prod images don't ship dotenv; env comes from compose */ }
const mongoose = require('mongoose');
const mongodb = require('../src/services/mongodb.service');

const PLACEHOLDER = 'TO_BE_LINKED';

// Groups documents by a normalized key and returns the groups with more than one member.
async function findGroups(collection, { match = {}, key, project }) {
  return collection.aggregate([
    { $match: match },
    { $group: { _id: key, count: { $sum: 1 }, docs: { $push: project } } },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1, _id: 1 } },
  ], { allowDiskUse: true }).toArray();
}

function printGroups(title, groups, describe) {
  console.log(`\n## ${title}: ${groups.length === 0 ? 'none' : `${groups.length} group(s)`}`);
  groups.forEach((group) => {
    console.log(`\n  ${JSON.stringify(group._id)} (${group.count} records)`);
    group.docs.forEach((doc) => console.log(`    - ${describe(doc)}`));
  });
}

const fmtDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : 'unknown');

const describeAccount = (a) => [
  `_id=${a._id}`,
  `username=${JSON.stringify(a.username)}`,
  `email=${JSON.stringify(a.email)}`,
  `roles=${(a.roles || []).join('|') || '-'}`,
  `approved=${Boolean(a.isApproved)}`,
  `devices=${(a.devices || []).length}`,
  `created=${fmtDate(a.createdAt)}`,
].join('  ');

const describeDevice = (d) => [
  `_id=${d._id}`,
  `network.station=${d.network}.${d.station}`,
  `streamId=${JSON.stringify(d.streamId)}`,
  `mac=${JSON.stringify(d.macAddress)}`,
  `activity=${d.activity}`,
].join('  ');

// Prints the report and returns the list of blockers ([label, count] pairs); empty means safe.
async function checkDuplicates(db) {
  const accounts = db.collection('accounts');
  const devices = db.collection('devices');

  const accountFields = { _id: '$_id', username: '$username', email: '$email', roles: '$roles', isApproved: '$isApproved', devices: '$devices', createdAt: '$createdAt' };
  const deviceFields = { _id: '$_id', network: '$network', station: '$station', streamId: '$streamId', macAddress: '$macAddress', activity: '$activity' };

  console.log(`# Duplicate check on "${db.databaseName}" (${new Date().toISOString()})`);
  console.log(`accounts: ${await accounts.countDocuments()}  devices: ${await devices.countDocuments()}`);

  // ---------- accounts ----------
  const emailDupes = await findGroups(accounts, {
    match: { email: { $type: 'string' } },
    key: { $toLower: { $trim: { input: '$email' } } },
    project: accountFields,
  });
  const usernameDupes = await findGroups(accounts, {
    match: { username: { $type: 'string' } },
    key: '$username',
    project: accountFields,
  });
  // Not a blocker for a case-sensitive username index, but worth knowing (look-alike accounts).
  const usernameCaseDupes = await findGroups(accounts, {
    match: { username: { $type: 'string' } },
    key: { $toLower: { $trim: { input: '$username' } } },
    project: accountFields,
  });
  // A unique index treats every missing value as the same null, so more than one blocks it.
  const missingEmail = await accounts.countDocuments({ $or: [{ email: { $exists: false } }, { email: null }, { email: '' }] });
  const missingUsername = await accounts.countDocuments({ $or: [{ username: { $exists: false } }, { username: null }, { username: '' }] });
  const emailsToNormalize = await accounts.countDocuments({
    email: { $type: 'string' },
    $expr: { $ne: ['$email', { $toLower: { $trim: { input: '$email' } } }] },
  });

  printGroups('accounts: duplicate email (case-insensitive, trimmed)', emailDupes, describeAccount);
  printGroups('accounts: duplicate username (exact)', usernameDupes, describeAccount);
  const lookAlikes = usernameCaseDupes.filter((g) => g.docs.some((d) => d.username !== g.docs[0].username));
  printGroups('accounts: usernames differing only by case/spaces (info, not a blocker)', lookAlikes, describeAccount);
  console.log(`\n## accounts: missing/empty email: ${missingEmail}, missing/empty username: ${missingUsername}`);
  console.log(`## accounts: emails that need lowercasing/trimming: ${emailsToNormalize}`);

  // ---------- devices ----------
  const linkedOnly = (field) => ({ [field]: { $type: 'string', $nin: [PLACEHOLDER, ''] } });
  const streamDupes = await findGroups(devices, { match: linkedOnly('streamId'), key: '$streamId', project: deviceFields });
  const macDupes = await findGroups(devices, {
    match: linkedOnly('macAddress'),
    key: { $toLower: { $trim: { input: '$macAddress' } } },
    project: deviceFields,
  });
  const stationDupes = await findGroups(devices, { key: { network: '$network', station: '$station' }, project: deviceFields });

  printGroups('devices: duplicate streamId (excluding placeholder)', streamDupes, describeDevice);
  printGroups('devices: duplicate macAddress (case-insensitive, excluding placeholder)', macDupes, describeDevice);
  printGroups('devices: duplicate network + station', stationDupes, describeDevice);

  const placeholderStream = await devices.countDocuments({ streamId: PLACEHOLDER });
  const placeholderMac = await devices.countDocuments({ macAddress: PLACEHOLDER });
  const activityValues = await devices.aggregate([
    { $group: { _id: '$activity', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]).toArray();
  console.log(`\n## devices: "${PLACEHOLDER}" placeholders: streamId=${placeholderStream}, macAddress=${placeholderMac} (become null in the migration)`);
  console.log(`## devices: activity values: ${activityValues.map((v) => `${JSON.stringify(v._id)}=${v.count}`).join(', ') || 'none'}`);

  // ---------- summary ----------
  const blockers = [
    ['duplicate account emails', emailDupes.length],
    ['duplicate account usernames', usernameDupes.length],
    ['accounts missing an email', missingEmail > 1 ? missingEmail : 0],
    ['accounts missing a username', missingUsername > 1 ? missingUsername : 0],
    ['duplicate device streamIds', streamDupes.length],
    ['duplicate device MAC addresses', macDupes.length],
    ['duplicate device network+station', stationDupes.length],
  ].filter(([, n]) => n > 0);

  console.log('\n# Summary');
  if (blockers.length === 0) {
    console.log('No blockers: the unique indexes can be created.');
  } else {
    blockers.forEach(([label, n]) => console.log(`BLOCKER: ${n} ${label}`));
    console.log('Resolve these (agree with the team which record to keep) before adding the unique indexes.');
  }
  return blockers;
}

async function connectOrThrow() {
  await mongodb.connect({ serverSelectionTimeoutMS: 10000 });
  if (mongoose.connection.readyState !== 1) {
    throw new Error(
      'Could not connect to MongoDB (check MONGO_* settings).\n'
      + 'The "mongodb" host only resolves inside Docker, so run this inside the backend container, e.g.\n'
      + `  docker exec -w /app earthquake-hub-backend-dev node scripts/${require('path').basename(process.argv[1])}`
    );
  }
  return mongoose.connection.db;
}

module.exports = { checkDuplicates, connectOrThrow };

if (require.main === module) {
  connectOrThrow()
    .then(checkDuplicates)
    .then(async (blockers) => { await mongoose.disconnect(); process.exit(blockers.length === 0 ? 0 : 1); })
    .catch(async (err) => {
      console.error(`find-duplicates failed: ${err.message}`);
      await mongoose.disconnect().catch(() => {});
      process.exit(2);
    });
}
