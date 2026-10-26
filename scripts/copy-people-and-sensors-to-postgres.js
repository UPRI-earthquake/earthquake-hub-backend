// Copies accounts, devices and released devices from MongoDB to PostgreSQL (`accounts`, `devices`,
// `device_releases`). Safe to run more than once: rows are matched by legacy_mongo_id (the MongoDB _id).
//
//   1. Accounts. Ones that can't be stored (no email, username or password; unknown role; bad
//      ringserver port) are skipped, and so are ones that would collide in PostgreSQL: the same email,
//      username (compared without regard to case) or ringserver URL as another account. Colliding
//      accounts are all skipped, since picking one would be a guess; resolve them in MongoDB first.
//   2. Devices, with their owner taken from the accounts' devices[] lists. A brgy account's list holds
//      devices it forwards data for, not devices it owns, so it doesn't count as ownership (those links
//      are counted, not copied: PostgreSQL has no table for them yet). A device listed by two owners
//      is copied without an owner and reported. Devices with missing or invalid coordinates, or that
//      would collide (network + station, stream ID, MAC), are skipped.
//   3. Released devices (accounts' releasedDevices[]), for the copied accounts. History never changes,
//      so entries already copied are left alone.
//   4. Checks that every copyable record now has its row, and that the counts add up, per table.
//
// Rows changed in PostgreSQL since they were copied (newer updated_at) are kept, so re-running after
// the switch never overwrites newer data. Password hashes are copied as they are (bcrypt). The report
// only ever names MongoDB _ids: never emails, usernames or hashes.
//
//   dry run (no changes): docker exec -w /app earthquake-hub-backend-dev node scripts/copy-people-and-sensors-to-postgres.js --dry-run
//   copy:                 docker exec -w /app earthquake-hub-backend-dev node scripts/copy-people-and-sensors-to-postgres.js
//
// Run `npm run db:find-duplicates` first. Accounts hold personal data: run this against real data only
// on the server or a sanitized dump.
// Exit code: 0 = done (or dry run), 1 = validation failed, 2 = error. Skipped records alone don't fail it.
try { require('dotenv/config'); } catch (_) { /* prod images don't ship dotenv; env comes from compose */ }
const mongoose = require('mongoose');
const {
  chunk, toDate, upsertByLegacyId, insertMissingByLegacyId, idsByLegacyId, missingLegacyIds,
} = require('./lib/pgCopy');

const ROLES = new Set(['citizen', 'sensor', 'brgy', 'admin']);
// 'streaming' is a legacy name for 'active' (device.service.js treats them the same)
const ACTIVITIES = { active: 'active', streaming: 'active', inactive: 'inactive', unlinked: 'unlinked' };

// Columns overwritten when a copied row is refreshed (everything but the ids)
const ACCOUNT_COLUMNS = [
  'email', 'username', 'password_hash', 'roles', 'is_approved', 'password_policy_version', 'password_updated_at',
  'password_reset_token_id', 'password_reset_issued_at', 'password_reset_used_at', 'ringserver_url',
  'ringserver_port', 'rshake_email_enabled', 'alert_prefs_updated_at', 'created_at', 'updated_at',
];
const DEVICE_COLUMNS = [
  'owner_account_id', 'network', 'station', 'description', 'stream_id', 'mac_address', 'latitude', 'longitude',
  'elevation_m', 'activity', 'activity_toggled_at', 'rshake_alert_credential_hash',
  'rshake_alert_credential_issued_at', 'created_at', 'updated_at',
];

const isMissing = (value) => value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
const textOrNull = (value) => (isMissing(value) ? null : String(value));
const numberOrNull = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const createdAtOf = (doc) => toDate(doc.createdAt) || doc._id.getTimestamp();
const isBrgy = (doc) => Array.isArray(doc.roles) && doc.roles.includes('brgy');
const listedIds = (list) => (Array.isArray(list) ? list.filter(Boolean).map(String) : []);

// Groups records by a key; returns the groups with more than one record
const collisions = (records, keyOf) => {
  const groups = new Map();
  records.forEach((record) => {
    const key = keyOf(record);
    if (key === null) return;
    groups.set(key, [...(groups.get(key) || []), record]);
  });
  return [...groups.values()].filter((group) => group.length > 1);
};

// --- Accounts ---

const accountProblem = (doc) => {
  if (isMissing(doc.email)) return 'no email';
  if (isMissing(doc.username)) return 'no username';
  if (isMissing(doc.password)) return 'no password';
  const unknown = (doc.roles || []).filter((role) => !ROLES.has(role));
  if (unknown.length > 0) return `unknown role ${JSON.stringify(unknown)}`;
  if (doc.ringserverPort !== undefined && doc.ringserverPort !== null
    && !(Number.isInteger(doc.ringserverPort) && doc.ringserverPort >= 1 && doc.ringserverPort <= 65535)) {
    return `ringserver port ${JSON.stringify(doc.ringserverPort)} not between 1 and 65535`;
  }
  return null;
};

const toAccountRow = (doc) => {
  const createdAt = createdAtOf(doc);
  return {
    legacy_mongo_id: String(doc._id),
    email: doc.email.trim(),
    username: doc.username,
    password_hash: doc.password,
    roles: [...new Set(doc.roles || [])],
    is_approved: Boolean(doc.isApproved),
    password_policy_version: Number.isInteger(doc.passwordPolicyVersion) ? doc.passwordPolicyVersion : 1,
    password_updated_at: toDate(doc.passwordUpdatedAt),
    password_reset_token_id: textOrNull(doc.passwordResetTokenId),
    password_reset_issued_at: toDate(doc.passwordResetIssuedAt),
    password_reset_used_at: toDate(doc.passwordResetUsedAt),
    ringserver_url: textOrNull(doc.ringserverUrl),
    ringserver_port: Number.isInteger(doc.ringserverPort) ? doc.ringserverPort : null,
    rshake_email_enabled: Boolean(doc.alertPreferences?.rshakeEmailEnabled),
    alert_prefs_updated_at: toDate(doc.alertPreferences?.updatedAt),
    created_at: createdAt,
    updated_at: toDate(doc.updatedAt) || createdAt,
  };
};

// --- Devices ---

const deviceProblem = (doc) => {
  if (isMissing(doc.network) || isMissing(doc.station)) return 'no network or station';
  const latitude = numberOrNull(doc.latitude);
  const longitude = numberOrNull(doc.longitude);
  if (latitude === null || longitude === null) return 'missing coordinates';
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return `invalid coordinates (${doc.latitude}, ${doc.longitude})`;
  }
  if (numberOrNull(doc.elevation) === null) return 'missing elevation';
  if (doc.activity !== undefined && doc.activity !== null && !ACTIVITIES[doc.activity]) {
    return `unknown activity ${JSON.stringify(doc.activity)}`;
  }
  return null;
};

const toDeviceRow = (doc, ownerAccountId) => {
  const createdAt = createdAtOf(doc);
  return {
    legacy_mongo_id: String(doc._id),
    owner_account_id: ownerAccountId,
    network: doc.network,
    station: doc.station,
    description: textOrNull(doc.description),
    stream_id: textOrNull(doc.streamId),
    mac_address: textOrNull(doc.macAddress),
    latitude: doc.latitude,
    longitude: doc.longitude,
    elevation_m: doc.elevation,
    activity: ACTIVITIES[doc.activity] || 'inactive',
    activity_toggled_at: toDate(doc.activityToggleTime) || new Date(0),
    rshake_alert_credential_hash: textOrNull(doc.rshakeAlertCredentialHash),
    rshake_alert_credential_issued_at: toDate(doc.rshakeAlertCredentialIssuedAt),
    created_at: createdAt,
    updated_at: toDate(doc.updatedAt) || createdAt,
  };
};

// --- Released devices ---

const toReleaseRow = (entry, account, accountId, deviceIds) => ({
  legacy_mongo_id: String(entry._id),
  account_id: accountId,
  device_id: (entry.deviceId && deviceIds.get(String(entry.deviceId))) || null,
  network: textOrNull(entry.network),
  station: textOrNull(entry.station),
  stream_id: textOrNull(entry.streamId),
  mac_address: textOrNull(entry.macAddress),
  description: textOrNull(entry.description),
  latitude: numberOrNull(entry.latitude),
  longitude: numberOrNull(entry.longitude),
  elevation_m: numberOrNull(entry.elevation),
  reason: textOrNull(entry.reason) || 'unlink',
  released_at: toDate(entry.releasedAt) || createdAtOf(account),
});

// Legacy ids of PostgreSQL rows (copied under another legacy id, or created in PostgreSQL) that already
// hold one of these values, by value. `column` compared case-insensitively when `lower` is set.
async function existingByValue(db, table, column, values, { lower = false } = {}) {
  const found = new Map();
  for (const batch of chunk([...new Set(values.filter((v) => v !== null))])) {
    const rows = lower
      ? await db(table).select('legacy_mongo_id', db.raw(`lower(${column}::text) AS value`))
        .whereRaw(`lower(${column}::text) = ANY(?)`, [batch.map((v) => v.toLowerCase())])
      : await db(table).select('legacy_mongo_id', `${column} AS value`).whereIn(column, batch);
    rows.forEach((row) => found.set(row.value, (row.legacy_mongo_id || '').trim()));
  }
  return found;
}

// Same, for network + station pairs (keyed `${network}\u0000${station}`)
async function existingStations(db, devices) {
  const found = new Map();
  for (const batch of chunk(devices)) {
    const rows = await db('devices').select('legacy_mongo_id', 'network', 'station')
      .whereIn(['network', 'station'], batch.map((doc) => [doc.network, doc.station]));
    rows.forEach((row) => found.set(`${row.network}\u0000${row.station}`, (row.legacy_mongo_id || '').trim()));
  }
  return found;
}

/***************************************************************************
  * copyPeopleAndSensors:
  *     Copies MongoDB accounts, devices and released devices to PostgreSQL (see the steps at the top
  *     of this file). Expects Mongoose to be connected already.
  *
  * Inputs:
  *     db:      Knex instance for PostgreSQL
  *     dryRun:  report what would change without writing
  *     log:     function for progress lines (default console.log)
  *
  * Outputs:
  *     { ok, accounts, devices, releases, ownership }, where each table has
  *     { mongoTotal, skipped: [{ id, reason }], inserted, updated, keptNewer, missing: [id] }
  *     (releases: inserted, alreadyCopied) and ownership lists what couldn't be decided:
  *     { sharedDevices: [{ id, accountIds }], ownerNotCopied: [{ id, accountId }],
  *       missingDevices: [{ accountId, deviceId }], brgyForwardingLinks }
 ***************************************************************************/
async function copyPeopleAndSensors({ db, dryRun = false, log = console.log }) {
  const accountDocs = await mongoose.connection.collection('accounts').find({}).toArray();
  const deviceDocs = await mongoose.connection.collection('devices').find({}).toArray();

  // 1. Accounts
  const accountsSkipped = [];
  let candidates = [];
  accountDocs.forEach((doc) => {
    const reason = accountProblem(doc);
    if (reason) accountsSkipped.push({ id: String(doc._id), reason });
    else candidates.push(doc);
  });

  const colliding = new Map(); // _id -> reason
  [
    ['email', (doc) => doc.email.trim().toLowerCase()],
    ['username', (doc) => doc.username.toLowerCase()],
    ['ringserver URL', (doc) => textOrNull(doc.ringserverUrl)],
  ].forEach(([what, keyOf]) => {
    collisions(candidates, keyOf).forEach((group) => {
      group.forEach((doc) => {
        const others = group.filter((other) => other !== doc).map((other) => String(other._id));
        colliding.set(String(doc._id), `same ${what} as ${others.join(', ')} (ignoring case)`);
      });
    });
  });
  candidates = candidates.filter((doc) => {
    const reason = colliding.get(String(doc._id));
    if (reason) accountsSkipped.push({ id: String(doc._id), reason });
    return !reason;
  });

  // Values PostgreSQL already holds under another row (e.g. an account created after the switch)
  const [byEmail, byUsername, byRingserver] = await Promise.all([
    existingByValue(db, 'accounts', 'email', candidates.map((doc) => doc.email.trim()), { lower: true }),
    existingByValue(db, 'accounts', 'username', candidates.map((doc) => doc.username), { lower: true }),
    existingByValue(db, 'accounts', 'ringserver_url', candidates.map((doc) => textOrNull(doc.ringserverUrl))),
  ]);
  const accountRows = candidates.map(toAccountRow).filter((row) => {
    const takenBy = (map, value) => map.has(value) && map.get(value) !== row.legacy_mongo_id;
    const reason = (takenBy(byEmail, row.email.toLowerCase()) && 'email already used by another PostgreSQL account')
      || (takenBy(byUsername, row.username.toLowerCase()) && 'username already used by another PostgreSQL account')
      || (row.ringserver_url && takenBy(byRingserver, row.ringserver_url) && 'ringserver URL already used by another PostgreSQL account');
    if (reason) accountsSkipped.push({ id: row.legacy_mongo_id, reason });
    return !reason;
  });

  const accountCounts = await upsertByLegacyId({ db, table: 'accounts', rows: accountRows, columns: ACCOUNT_COLUMNS, dryRun });
  const copiedAccountIds = new Set(accountRows.map((row) => row.legacy_mongo_id));
  const accountIds = dryRun ? new Map() : await idsByLegacyId(db, 'accounts', [...copiedAccountIds]);

  // 2. Devices and their owners
  const deviceIdsInMongo = new Set(deviceDocs.map((doc) => String(doc._id)));
  const ownersByDevice = new Map();
  const missingDevices = [];
  let brgyForwardingLinks = 0;
  accountDocs.forEach((doc) => {
    listedIds(doc.devices).forEach((deviceId) => {
      if (!deviceIdsInMongo.has(deviceId)) {
        missingDevices.push({ accountId: String(doc._id), deviceId });
      } else if (isBrgy(doc)) {
        brgyForwardingLinks += 1;
      } else {
        ownersByDevice.set(deviceId, [...new Set([...(ownersByDevice.get(deviceId) || []), String(doc._id)])]);
      }
    });
  });

  const devicesSkipped = [];
  let deviceCandidates = [];
  deviceDocs.forEach((doc) => {
    const reason = deviceProblem(doc);
    if (reason) devicesSkipped.push({ id: String(doc._id), reason });
    else deviceCandidates.push(doc);
  });

  const deviceColliding = new Map();
  [
    ['network and station', (doc) => `${doc.network}\u0000${doc.station}`],
    ['stream ID', (doc) => textOrNull(doc.streamId)],
    ['MAC address', (doc) => textOrNull(doc.macAddress)],
  ].forEach(([what, keyOf]) => {
    collisions(deviceCandidates, keyOf).forEach((group) => {
      group.forEach((doc) => {
        const others = group.filter((other) => other !== doc).map((other) => String(other._id));
        deviceColliding.set(String(doc._id), `same ${what} as ${others.join(', ')}`);
      });
    });
  });
  deviceCandidates = deviceCandidates.filter((doc) => {
    const reason = deviceColliding.get(String(doc._id));
    if (reason) devicesSkipped.push({ id: String(doc._id), reason });
    return !reason;
  });

  const sharedDevices = [];
  const ownerNotCopied = [];
  const ownerOf = (deviceId) => {
    const owners = ownersByDevice.get(deviceId) || [];
    if (owners.length > 1) {
      sharedDevices.push({ id: deviceId, accountIds: owners });
      return null;
    }
    if (owners.length === 1 && !copiedAccountIds.has(owners[0])) {
      ownerNotCopied.push({ id: deviceId, accountId: owners[0] });
      return null;
    }
    return owners.length === 1 ? (accountIds.get(owners[0]) || null) : null;
  };

  const [byStation, byStream, byMac] = await Promise.all([
    existingStations(db, deviceCandidates),
    existingByValue(db, 'devices', 'stream_id', deviceCandidates.map((doc) => textOrNull(doc.streamId))),
    existingByValue(db, 'devices', 'mac_address', deviceCandidates.map((doc) => textOrNull(doc.macAddress))),
  ]);
  const deviceRows = deviceCandidates.map((doc) => toDeviceRow(doc, ownerOf(String(doc._id)))).filter((row) => {
    const takenBy = (map, value) => value !== null && map.has(value) && map.get(value) !== row.legacy_mongo_id;
    const reason = (takenBy(byStation, `${row.network}\u0000${row.station}`) && 'network and station already used by another PostgreSQL device')
      || (takenBy(byStream, row.stream_id) && 'stream ID already used by another PostgreSQL device')
      || (takenBy(byMac, row.mac_address) && 'MAC address already used by another PostgreSQL device');
    if (reason) devicesSkipped.push({ id: row.legacy_mongo_id, reason });
    return !reason;
  });

  const deviceCounts = await upsertByLegacyId({ db, table: 'devices', rows: deviceRows, columns: DEVICE_COLUMNS, dryRun });
  const deviceIds = dryRun ? new Map() : await idsByLegacyId(db, 'devices', deviceRows.map((row) => row.legacy_mongo_id));

  // 3. Released devices of the copied accounts
  const releasesSkipped = [];
  const releaseRows = [];
  let releasesTotal = 0;
  accountDocs.forEach((doc) => {
    (Array.isArray(doc.releasedDevices) ? doc.releasedDevices.filter(Boolean) : []).forEach((entry) => {
      releasesTotal += 1;
      if (!entry._id) {
        releasesSkipped.push({ id: String(doc._id), reason: 'released-device entry without an _id (account id shown)' });
      } else if (!copiedAccountIds.has(String(doc._id))) {
        releasesSkipped.push({ id: String(entry._id), reason: `its account ${doc._id} wasn't copied` });
      } else {
        releaseRows.push(toReleaseRow(entry, doc, accountIds.get(String(doc._id)) || null, deviceIds));
      }
    });
  });
  const releaseCounts = await insertMissingByLegacyId({ db, table: 'device_releases', rows: releaseRows, dryRun });

  // 4. Validation: every copyable record has its row, and the counts add up
  const missing = async (table, rows) => (dryRun ? [] : missingLegacyIds(db, table, rows.map((row) => row.legacy_mongo_id)));
  const accounts = {
    mongoTotal: accountDocs.length, skipped: accountsSkipped, ...accountCounts, missing: await missing('accounts', accountRows),
  };
  const devices = {
    mongoTotal: deviceDocs.length, skipped: devicesSkipped, ...deviceCounts, missing: await missing('devices', deviceRows),
  };
  const releases = {
    mongoTotal: releasesTotal, skipped: releasesSkipped, ...releaseCounts, missing: await missing('device_releases', releaseRows),
  };
  const upsertAddsUp = (table, rows) => table.mongoTotal === table.skipped.length + rows.length
    && rows.length === table.inserted + table.updated + table.keptNewer;
  const countsAddUp = upsertAddsUp(accounts, accountRows) && upsertAddsUp(devices, deviceRows)
    && releases.mongoTotal === releases.skipped.length + releaseRows.length
    && releaseRows.length === releases.inserted + releases.alreadyCopied;
  const ok = countsAddUp && accounts.missing.length === 0 && devices.missing.length === 0 && releases.missing.length === 0;
  const ownership = { sharedDevices, ownerNotCopied, missingDevices, brgyForwardingLinks };

  // Report: MongoDB _ids only
  const would = (word) => (dryRun ? `would ${word}` : { insert: 'inserted', update: 'updated' }[word]);
  const listSkipped = (skipped) => skipped.forEach(({ id, reason }) => log(`    ${id}: ${reason}`));
  log(`${dryRun ? '[dry run] ' : ''}Accounts in MongoDB: ${accounts.mongoTotal}`);
  log(`  ${would('insert')}: ${accounts.inserted}, ${would('update')}: ${accounts.updated}, kept (changed in PostgreSQL since copied): ${accounts.keptNewer}`);
  log(`  skipped: ${accounts.skipped.length}`);
  listSkipped(accounts.skipped);
  log(`Devices in MongoDB: ${devices.mongoTotal}`);
  log(`  ${would('insert')}: ${devices.inserted}, ${would('update')}: ${devices.updated}, kept (changed in PostgreSQL since copied): ${devices.keptNewer}`);
  log(`  skipped: ${devices.skipped.length}`);
  listSkipped(devices.skipped);
  log(`Released devices in MongoDB: ${releases.mongoTotal}`);
  log(`  ${would('insert')}: ${releases.inserted}, already copied: ${releases.alreadyCopied}`);
  log(`  skipped: ${releases.skipped.length}`);
  listSkipped(releases.skipped);
  log('Ownership:');
  log(`  devices listed by more than one owner (copied without an owner): ${sharedDevices.length}`);
  sharedDevices.forEach(({ id, accountIds: owners }) => log(`    ${id}: listed by ${owners.join(', ')}`));
  log(`  devices whose owner wasn't copied (copied without an owner): ${ownerNotCopied.length}`);
  ownerNotCopied.forEach(({ id, accountId }) => log(`    ${id}: owner ${accountId}`));
  log(`  accounts listing a device that doesn't exist: ${missingDevices.length}`);
  missingDevices.forEach(({ accountId, deviceId }) => log(`    account ${accountId} lists ${deviceId}`));
  log(`  brgy forwarding links (not copied: no PostgreSQL table yet): ${brgyForwardingLinks}`);
  if (!dryRun) {
    const missingTotal = accounts.missing.length + devices.missing.length + releases.missing.length;
    log(missingTotal === 0
      ? 'Validation passed: every copyable account, device and released device is in PostgreSQL.'
      : `Validation FAILED: no PostgreSQL row for ${[...accounts.missing, ...devices.missing, ...releases.missing].join(', ')}`);
  }
  if (!countsAddUp) log('Validation FAILED: counts do not add up.');

  return { ok, accounts, devices, releases, ownership };
}

module.exports = { copyPeopleAndSensors };

if (require.main === module) {
  const { connectOrThrow } = require('./find-duplicates');
  const postgres = require('../src/db/knex');
  const dryRun = process.argv.includes('--dry-run');

  connectOrThrow()
    .then(() => copyPeopleAndSensors({ db: postgres.db, dryRun }))
    .then(async ({ ok }) => {
      await mongoose.disconnect();
      await postgres.db.destroy();
      process.exit(ok ? 0 : 1);
    })
    .catch(async (err) => {
      console.error(`copy-people-and-sensors-to-postgres failed: ${err.message}`);
      await mongoose.disconnect().catch(() => {});
      await postgres.db.destroy().catch(() => {});
      process.exit(2);
    });
}
