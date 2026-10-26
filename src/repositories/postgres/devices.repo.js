// Devices, account device lists and release history in PostgreSQL: the same functions and shapes as
// ../devices.repo.js (MongoDB), which both must keep (__tests__/peopleAndSensors.repo.integration.test.js).
//
// What MongoDB kept in one array per account is split here:
//   - a citizen/sensor account's list = the devices it owns (devices.owner_account_id), oldest first
//   - a brgy account's list = the devices it forwards data for (brgy_forwarded_devices), in the order added
//   - releasedDevices[] = device_releases rows
// A write that breaks a unique rule (network+station, stream ID, MAC) throws DuplicateKeyError.
// Functions that take { tx } run on that Knex transaction (postgres/transactions.js).
const { fromPostgresError } = require('../errors');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (id) => UUID.test(String(id));

// Device fields -> columns
const COLUMN_OF = {
  description: 'description',
  network: 'network',
  station: 'station',
  streamId: 'stream_id',
  macAddress: 'mac_address',
  latitude: 'latitude',
  longitude: 'longitude',
  elevation: 'elevation_m',
  activity: 'activity',
  activityToggleTime: 'activity_toggled_at',
  rshakeAlertCredentialHash: 'rshake_alert_credential_hash',
  rshakeAlertCredentialIssuedAt: 'rshake_alert_credential_issued_at',
};

// null when there's no row, as the MongoDB repository returns
const toDevice = (row) => (!row ? null : {
  id: row.id,
  // MongoDB left description out when unset (no default); the other nullable fields defaulted to null
  description: row.description === null ? undefined : row.description,
  network: row.network,
  station: row.station,
  streamId: row.stream_id,
  macAddress: row.mac_address,
  latitude: row.latitude,
  longitude: row.longitude,
  elevation: row.elevation_m,
  activity: row.activity,
  activityToggleTime: row.activity_toggled_at,
  rshakeAlertCredentialHash: row.rshake_alert_credential_hash,
  rshakeAlertCredentialIssuedAt: row.rshake_alert_credential_issued_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toRelease = (row) => ({
  deviceId: row.device_id,
  network: row.network,
  station: row.station,
  description: row.description,
  streamId: row.stream_id,
  macAddress: row.mac_address,
  longitude: row.longitude,
  latitude: row.latitude,
  elevation: row.elevation_m,
  releasedAt: row.released_at,
  reason: row.reason,
});

const toColumns = (fields) => {
  const row = {};
  Object.entries(fields).forEach(([field, value]) => {
    if (COLUMN_OF[field]) row[COLUMN_OF[field]] = value === undefined ? null : value;
  });
  return row;
};

const OLDEST_FIRST = [{ column: 'created_at' }, { column: 'id' }];

// `db` is a Knex instance (src/db/knex.js in the app, a test container's in integration tests)
const createDevicesRepo = (db) => {
  const q = (tx) => (tx || db);
  const one = async (where, tx) => toDevice(await q(tx)('devices').where(where).first());

  // A brgy account's list is its forwarding links; everyone else's is the devices it owns
  async function isBrgy(accountId, tx) {
    const account = await q(tx)('accounts').select(db.raw("'brgy' = ANY(roles) AS brgy")).where({ id: accountId }).first();
    return Boolean(account?.brgy);
  }

  // --- Devices ---

  async function findById(id) {
    return isUuid(id) ? one({ id }) : null;
  }

  const findByStreamId = (streamId) => one({ stream_id: streamId });
  const findByMacAddress = (macAddress) => one({ mac_address: macAddress });
  const findByNetworkStation = (network, station) => one({ network, station });

  async function findByMacAddressOrStreamId({ macAddress, streamId }) {
    if (!macAddress && !streamId) return [];
    const rows = await db('devices')
      .where((w) => {
        if (macAddress) w.orWhere('mac_address', macAddress);
        if (streamId) w.orWhere('stream_id', streamId);
      })
      .orderBy(OLDEST_FIRST);
    return rows.map(toDevice);
  }

  async function listByStreamIds(streamIds) {
    if (streamIds.length === 0) return [];
    const rows = await db('devices').select('id', 'stream_id', 'activity', 'activity_toggled_at').whereIn('stream_id', streamIds);
    return rows.map((row) => ({
      id: row.id,
      streamId: row.stream_id,
      activity: row.activity,
      activityToggleTime: row.activity_toggled_at,
    }));
  }

  // Every device, for the station map: [{ network, station, latitude, longitude, activity, description }]
  async function listLocations() {
    return db('devices').select('network', 'station', 'latitude', 'longitude', 'activity', 'description').orderBy(OLDEST_FIRST);
  }

  // [{ station, latitude, longitude }] (coordinates are always set here); `activity`: only this activity
  async function listStationLocations({ activity } = {}) {
    const query = db('devices').select('station', 'latitude', 'longitude').orderBy(OLDEST_FIRST);
    if (activity) query.where({ activity });
    return query;
  }

  async function create(fields, { tx } = {}) {
    let id;
    try {
      [{ id }] = await q(tx)('devices').insert(toColumns(fields)).returning('id');
    } catch (err) {
      throw fromPostgresError(err);
    }
    return one({ id }, tx);
  }

  async function update(id, changes, { tx } = {}) {
    if (!isUuid(id)) return null;
    const columns = toColumns(changes);
    if (Object.keys(columns).length === 0) return one({ id }, tx);
    let updated;
    try {
      updated = await q(tx)('devices').where({ id }).update(columns);
    } catch (err) {
      throw fromPostgresError(err);
    }
    return updated === 0 ? null : one({ id }, tx);
  }

  // Resolves to how many devices it updated: every one that exists, as in MongoDB (where updatedAt
  // changes even when the description is already the same)
  async function setDescription(ids, description, { tx } = {}) {
    const valid = ids.filter(isUuid);
    if (valid.length === 0) return 0;
    return q(tx)('devices').whereIn('id', valid).update({ description });
  }

  async function remove(id) {
    if (isUuid(id)) await db('devices').where({ id }).del();
  }

  // --- Account device lists ---

  async function listAccountDevices(accountId) {
    if (!isUuid(accountId)) return [];
    const rows = await isBrgy(accountId)
      ? await db('devices AS d').join('brgy_forwarded_devices AS f', 'f.device_id', 'd.id')
        .select('d.*').where('f.brgy_account_id', accountId).orderBy([{ column: 'f.added_at' }, { column: 'd.id' }])
      : await db('devices').where({ owner_account_id: accountId }).orderBy(OLDEST_FIRST);
    return rows.map(toDevice);
  }

  async function listAccountDeviceIds(accountId) {
    return (await listAccountDevices(accountId)).map((device) => device.id);
  }

  async function accountHasDevice(accountId, deviceId) {
    return (await listAccountDeviceIds(accountId)).includes(String(deviceId));
  }

  // Adds devices to the account's list, skipping ones already in it: a brgy forwards them; any other
  // account becomes their owner
  async function addToAccount(accountId, deviceIds, { tx } = {}) {
    const ids = deviceIds.filter(isUuid);
    if (ids.length === 0 || !isUuid(accountId)) return;
    if (await isBrgy(accountId, tx)) {
      const now = Date.now();
      await q(tx)('brgy_forwarded_devices')
        .insert(ids.map((deviceId, i) => ({ brgy_account_id: accountId, device_id: deviceId, added_at: new Date(now + i) })))
        .onConflict(['brgy_account_id', 'device_id']).ignore();
      return;
    }
    await q(tx)('devices').whereIn('id', ids).update({ owner_account_id: accountId });
  }

  async function takeOutOfList(accountId, deviceId, tx) {
    if (await isBrgy(accountId, tx)) {
      await q(tx)('brgy_forwarded_devices').where({ brgy_account_id: accountId, device_id: deviceId }).del();
    } else {
      await q(tx)('devices').where({ id: deviceId, owner_account_id: accountId }).update({ owner_account_id: null });
    }
  }

  async function removeFromAccount(accountId, deviceId) {
    if (isUuid(accountId) && isUuid(deviceId)) await takeOutOfList(accountId, deviceId);
  }

  async function removeFromAllAccounts(deviceId) {
    if (!isUuid(deviceId)) return;
    await db.transaction(async (trx) => {
      await trx('devices').where({ id: deviceId }).update({ owner_account_id: null });
      await trx('brgy_forwarded_devices').where({ device_id: deviceId }).del();
    });
  }

  // Accounts listing this device: its owner first, then the brgys forwarding it: [{ id, username, email }].
  // `role`: only accounts with this role. `alertsEnabled`: only accounts with device alert emails on.
  async function findAccountsListing(deviceId, { role, alertsEnabled } = {}) {
    if (!isUuid(deviceId)) return [];
    const filters = (query) => {
      if (role) query.whereRaw('?::account_role = ANY(a.roles)', [role]);
      if (alertsEnabled) query.where('a.rshake_email_enabled', true);
      return query;
    };
    const owner = await filters(db('accounts AS a').join('devices AS d', 'd.owner_account_id', 'a.id')
      .select('a.id', 'a.username', 'a.email').where('d.id', deviceId));
    const brgys = await filters(db('accounts AS a').join('brgy_forwarded_devices AS f', 'f.brgy_account_id', 'a.id')
      .select('a.id', 'a.username', 'a.email').where('f.device_id', deviceId).orderBy('f.added_at'));
    return [...owner, ...brgys];
  }

  // --- Released devices ---

  async function listReleases(accountId) {
    if (!isUuid(accountId)) return [];
    const rows = await db('device_releases').where({ account_id: accountId })
      .orderBy([{ column: 'released_at' }, { column: 'id' }]);
    return rows.map(toRelease);
  }

  // The account releases the device: takes it out of the account's list and records `snapshot` (the
  // release fields) in its history, together (in `tx`, or in a transaction of its own)
  async function recordRelease(accountId, deviceId, snapshot, { tx } = {}) {
    const write = async (trx) => {
      await takeOutOfList(accountId, deviceId, trx);
      await trx('device_releases').insert({
        account_id: accountId,
        device_id: isUuid(snapshot.deviceId) ? snapshot.deviceId : deviceId,
        network: snapshot.network ?? null,
        station: snapshot.station ?? null,
        stream_id: snapshot.streamId ?? null,
        mac_address: snapshot.macAddress ?? null,
        description: snapshot.description ?? null,
        latitude: snapshot.latitude ?? null,
        longitude: snapshot.longitude ?? null,
        elevation_m: snapshot.elevation ?? null,
        reason: snapshot.reason || 'unlink',
        released_at: snapshot.releasedAt || new Date(),
      });
    };
    return tx ? write(tx) : db.transaction(write);
  }

  // Deletes release history entries (from every account) matching any of the given identifiers.
  // Resolves to how many accounts' histories changed.
  async function clearReleases({ deviceId, streamId, macAddress }, { tx } = {}) {
    const conditions = [];
    if (deviceId && isUuid(deviceId)) conditions.push(['device_id', deviceId]);
    if (streamId) conditions.push(['stream_id', streamId]);
    if (macAddress) conditions.push(['mac_address', macAddress]);
    if (conditions.length === 0) return 0;
    const deleted = await q(tx)('device_releases')
      .where((w) => conditions.forEach(([column, value]) => w.orWhere(column, value)))
      .del()
      .returning('account_id');
    return new Set(deleted.map((row) => row.account_id)).size;
  }

  return {
    findById,
    findByStreamId,
    findByMacAddress,
    findByNetworkStation,
    findByMacAddressOrStreamId,
    listByStreamIds,
    listLocations,
    listStationLocations,
    create,
    update,
    setDescription,
    remove,
    listAccountDeviceIds,
    listAccountDevices,
    accountHasDevice,
    addToAccount,
    removeFromAccount,
    removeFromAllAccounts,
    findAccountsListing,
    listReleases,
    recordRelease,
    clearReleases,
  };
};

module.exports = { createDevicesRepo };
