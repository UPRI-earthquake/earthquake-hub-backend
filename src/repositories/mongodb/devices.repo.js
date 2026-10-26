// Devices (Raspberry Shake sensors), which devices each account lists, and the history of devices an
// account released, in MongoDB: the implementation used when PEOPLE_AND_SENSORS_DB=mongodb. Keep it
// behaving like postgres/devices.repo.js: both must pass __tests__/peopleAndSensors.repo.integration.test.js.
//
// Devices are returned as plain objects:
//   { id, legacyId (= id here: the MongoDB _id), description, network, station, streamId, macAddress,
//     latitude, longitude, elevation, activity, activityToggleTime, rshakeAlertCredentialHash,
//     rshakeAlertCredentialIssuedAt, createdAt, updatedAt }
// Released devices: { deviceId (the device's legacyId), network, station, ..., releasedAt, reason }
//
// An account's device list holds the devices a citizen/sensor account owns. A brgy account's list
// holds the devices it forwards data for, which belong to other accounts.
//
// Writes load and save the document, so the model's hook (location from latitude/longitude), defaults
// and timestamps apply as before. A write that breaks a unique rule (network+station, streamId,
// macAddress) throws DuplicateKeyError. Functions that take { tx } join a transaction from
// transactions.js.
const Device = require('../../models/device.model');
const Account = require('../../models/account.model');
const { fromMongoError } = require('../errors');

const toDevice = (doc) => doc && {
  id: String(doc._id),
  legacyId: String(doc._id),
  description: doc.description,
  network: doc.network,
  station: doc.station,
  streamId: doc.streamId,
  macAddress: doc.macAddress,
  latitude: doc.latitude,
  longitude: doc.longitude,
  elevation: doc.elevation,
  activity: doc.activity,
  activityToggleTime: doc.activityToggleTime,
  rshakeAlertCredentialHash: doc.rshakeAlertCredentialHash,
  rshakeAlertCredentialIssuedAt: doc.rshakeAlertCredentialIssuedAt,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
};

const toRelease = (entry) => ({
  deviceId: entry.deviceId ? String(entry.deviceId) : null,
  network: entry.network,
  station: entry.station,
  description: entry.description,
  streamId: entry.streamId,
  macAddress: entry.macAddress,
  longitude: entry.longitude,
  latitude: entry.latitude,
  elevation: entry.elevation,
  releasedAt: entry.releasedAt,
  reason: entry.reason,
});

const opts = (tx) => (tx ? { session: tx } : undefined);

const save = async (doc, tx, options = {}) => {
  try {
    await doc.save({ ...options, ...(tx ? { session: tx } : {}) });
  } catch (err) {
    throw fromMongoError(err);
  }
};

// --- Devices ---

async function findById(id) {
  return toDevice(await Device.findById(id));
}

async function findByStreamId(streamId) {
  return toDevice(await Device.findOne({ streamId }));
}

async function findByMacAddress(macAddress) {
  return toDevice(await Device.findOne({ macAddress }));
}

async function findByNetworkStation(network, station) {
  return toDevice(await Device.findOne({ network, station }));
}

// Every device matching either identifier (more than one means they belong to different devices)
async function findByMacAddressOrStreamId({ macAddress, streamId }) {
  const conditions = [];
  if (macAddress) conditions.push({ macAddress });
  if (streamId) conditions.push({ streamId });
  if (conditions.length === 0) return [];
  return (await Device.find({ $or: conditions })).map(toDevice);
}

// Status fields of the devices with these stream ids: [{ id, streamId, activity, activityToggleTime }]
async function listByStreamIds(streamIds) {
  const docs = await Device.find({ streamId: { $in: streamIds } }, { streamId: 1, activity: 1, activityToggleTime: 1 });
  return docs.map((doc) => ({
    id: String(doc._id),
    streamId: doc.streamId,
    activity: doc.activity,
    activityToggleTime: doc.activityToggleTime,
  }));
}

// Every device, for the station map: [{ network, station, latitude, longitude, activity, description }]
// (fields a record lacks are left out)
async function listLocations() {
  return Device.find(
    {},
    { _id: 0, network: 1, station: 1, latitude: 1, longitude: 1, activity: 1, description: 1 },
  ).lean();
}

// Devices that can be placed on a map (station and coordinates set): [{ station, latitude, longitude }].
// `activity`: only devices with this activity.
async function listStationLocations({ activity } = {}) {
  const filter = {
    station: { $nin: [null, ''] },
    latitude: { $ne: null },
    longitude: { $ne: null },
  };
  if (activity) filter.activity = activity;
  return Device.find(filter, { _id: 0, station: 1, latitude: 1, longitude: 1 }).lean();
}

// `fields`: any device fields except id/createdAt/updatedAt
async function create(fields, { tx } = {}) {
  const doc = new Device(fields);
  await save(doc, tx);
  return toDevice(doc);
}

// Applies `changes` (device fields). Resolves to the updated device, or null when no device has this id.
// Only the changed fields are validated, so older records that lack a required field (e.g. elevation)
// can still be unlinked or relinked. Validating runs the model's hook that keeps location in sync.
async function update(id, changes, { tx } = {}) {
  const doc = await Device.findById(id).session(tx || null);
  if (!doc) return null;
  Object.entries(changes).forEach(([field, value]) => doc.set(field, value));
  await doc.validate(Object.keys(changes));
  await save(doc, tx, { validateBeforeSave: false });
  return toDevice(doc);
}

// Sets the description of several devices. Resolves to how many changed.
async function setDescription(ids, description, { tx } = {}) {
  if (ids.length === 0) return 0;
  const result = await Device.updateMany({ _id: { $in: ids } }, { $set: { description } }, opts(tx));
  return result?.modifiedCount || result?.nModified || 0;
}

async function remove(id) {
  await Device.deleteOne({ _id: id });
}

// --- Account device lists ---

// The ids in the account's device list, in order (including any whose device no longer exists)
async function listAccountDeviceIds(accountId) {
  const account = await Account.findById(accountId).select('devices');
  return (account?.devices || []).filter(Boolean).map(String);
}

// The devices in the account's device list, in order (skipping any that no longer exist)
async function listAccountDevices(accountId) {
  const ids = await listAccountDeviceIds(accountId);
  if (ids.length === 0) return [];
  const byId = new Map((await Device.find({ _id: { $in: ids } })).map((doc) => [String(doc._id), doc]));
  return ids.filter((id) => byId.has(id)).map((id) => toDevice(byId.get(id)));
}

async function accountHasDevice(accountId, deviceId) {
  return (await listAccountDeviceIds(accountId)).includes(String(deviceId));
}

// Adds devices to the end of the account's device list, skipping ones already in it
async function addToAccount(accountId, deviceIds, { tx } = {}) {
  if (deviceIds.length === 0) return;
  await Account.updateOne({ _id: accountId }, { $addToSet: { devices: { $each: deviceIds } } }, opts(tx));
}

async function removeFromAccount(accountId, deviceId) {
  await Account.updateOne({ _id: accountId }, { $pull: { devices: deviceId } });
}

async function removeFromAllAccounts(deviceId) {
  await Account.updateMany({ devices: deviceId }, { $pull: { devices: deviceId } });
}

// Accounts listing this device: [{ id, username, email }], in storage order.
// `role`: only accounts with this role. `alertsEnabled`: only accounts with device alert emails on.
async function findAccountsListing(deviceId, { role, alertsEnabled } = {}) {
  const filter = { devices: deviceId };
  if (role) filter.roles = role;
  if (alertsEnabled) filter['alertPreferences.rshakeEmailEnabled'] = true;
  const accounts = await Account.find(filter).select('username email');
  return accounts.map((account) => ({ id: String(account._id), username: account.username, email: account.email }));
}

// --- Released devices ---

// The account's released-device history, oldest first:
// [{ deviceId, network, station, description, streamId, macAddress, longitude, latitude, elevation, releasedAt, reason }]
async function listReleases(accountId) {
  const account = await Account.findById(accountId).select('releasedDevices');
  return (account?.releasedDevices || []).filter(Boolean).map(toRelease);
}

// The account releases the device: takes it out of the account's device list and records `snapshot`
// (the release fields above) in its history, in one write.
async function recordRelease(accountId, deviceId, snapshot, { tx } = {}) {
  await Account.updateOne(
    { _id: accountId },
    { $pull: { devices: deviceId }, $push: { releasedDevices: snapshot } },
    opts(tx),
  );
}

// Deletes release history entries (from every account) matching any of the given identifiers.
// Resolves to how many accounts changed.
async function clearReleases({ deviceId, streamId, macAddress }, { tx } = {}) {
  const conditions = [];
  if (deviceId) conditions.push({ deviceId });
  if (streamId) conditions.push({ streamId });
  if (macAddress) conditions.push({ macAddress });
  if (conditions.length === 0) return 0;

  const match = conditions.length === 1 ? conditions[0] : { $or: conditions };
  const result = await Account.updateMany(
    { releasedDevices: { $elemMatch: match } },
    { $pull: { releasedDevices: match } },
    opts(tx),
  );
  return result?.modifiedCount || result?.nModified || 0;
}

module.exports = {
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
