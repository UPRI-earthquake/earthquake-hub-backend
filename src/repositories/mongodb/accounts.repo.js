// Accounts in MongoDB (`accounts` collection): the implementation used when PEOPLE_AND_SENSORS_DB=mongodb.
// Keep it behaving like postgres/accounts.repo.js: both must pass
// __tests__/peopleAndSensors.repo.integration.test.js.
//
// Accounts are returned as plain objects:
//   { id, legacyId (= id here: the MongoDB _id), username, email, password (bcrypt hash), roles,
//     passwordPolicyVersion, passwordUpdatedAt,
//     passwordResetTokenId, passwordResetIssuedAt, passwordResetUsedAt, isApproved, ringserverUrl,
//     ringserverPort, alertPreferences: { rshakeEmailEnabled, updatedAt }, createdAt, updatedAt }
// Which devices an account lists, and its released-device history, are in devices.repo.js.
//
// Writes load and save the document, so the model's setters (email trimmed and lowercased), defaults
// and timestamps apply as before. A write that breaks a unique rule throws DuplicateKeyError.
// Functions that take { tx } join a transaction from transactions.js.
const User = require('../../models/account.model');
const { fromMongoError } = require('../errors');

const toAccount = (doc) => doc && {
  id: String(doc._id),
  legacyId: String(doc._id),
  username: doc.username,
  email: doc.email,
  password: doc.password,
  roles: doc.roles ? [...doc.roles] : [],
  passwordPolicyVersion: doc.passwordPolicyVersion,
  passwordUpdatedAt: doc.passwordUpdatedAt,
  passwordResetTokenId: doc.passwordResetTokenId,
  passwordResetIssuedAt: doc.passwordResetIssuedAt,
  passwordResetUsedAt: doc.passwordResetUsedAt,
  isApproved: doc.isApproved,
  ringserverUrl: doc.ringserverUrl,
  ringserverPort: doc.ringserverPort,
  alertPreferences: {
    rshakeEmailEnabled: doc.alertPreferences?.rshakeEmailEnabled,
    updatedAt: doc.alertPreferences?.updatedAt,
  },
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
};

const save = async (doc, tx) => {
  try {
    await (tx ? doc.save({ session: tx }) : doc.save());
  } catch (err) {
    throw fromMongoError(err);
  }
};

// `role`: only match an account that has this role
async function findByUsername(username, { role } = {}) {
  const filter = role ? { username, roles: role } : { username };
  return toAccount(await User.findOne(filter));
}

// Exact match: callers pass the normalized (trimmed, lowercase) email
async function findByEmail(email) {
  return toAccount(await User.findOne({ email }));
}

async function findByUsernameAndEmail(username, email) {
  return toAccount(await User.findOne({ username, email }));
}

async function findByRingserverUrl(ringserverUrl) {
  return toAccount(await User.findOne({ ringserverUrl }));
}

async function findById(id, { tx } = {}) {
  return toAccount(await User.findById(id).session(tx || null));
}

// `fields`: any account fields except id/createdAt/updatedAt
async function create(fields) {
  const doc = new User(fields);
  await save(doc);
  return toAccount(doc);
}

// Applies `changes` (account fields; undefined removes a field). Resolves to the updated account, or
// null when no account has this id.
async function update(id, changes, { tx } = {}) {
  const doc = await User.findById(id).session(tx || null);
  if (!doc) return null;
  Object.entries(changes).forEach(([field, value]) => doc.set(field, value));
  await save(doc, tx);
  return toAccount(doc);
}

async function remove(id) {
  await User.deleteOne({ _id: id });
}

// Approved brgy accounts: [{ username, ringserverUrl, ringserverPort }]
async function listApprovedRingserverHosts() {
  const hosts = await User.find(
    { roles: 'brgy', isApproved: true },
    'username ringserverUrl ringserverPort -_id',
  );
  return hosts.map((host) => host.toObject());
}

// The ringserver reported this sensor account connected at `at`. No-op for an unknown username.
async function recordRingserverConnection(username, at) {
  const doc = await User.findOne({ username });
  if (!doc) return;
  doc.updatedAt = at;
  await save(doc);
}

module.exports = {
  findByUsername,
  findByEmail,
  findByUsernameAndEmail,
  findByRingserverUrl,
  findById,
  create,
  update,
  remove,
  listApprovedRingserverHosts,
  recordRingserverConnection,
};
