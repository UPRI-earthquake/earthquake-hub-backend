// Accounts in PostgreSQL (`accounts` table): the same functions and account shape as ../accounts.repo.js
// (MongoDB), which both must keep (__tests__/peopleAndSensors.repo.integration.test.js).
//
// email and username are citext columns, so lookups match them without regard to case: no lowercasing
// in code. Writes still store the email trimmed and lowercased, as the MongoDB model's setter did, so
// the API shows the same values. A write that breaks a unique rule throws DuplicateKeyError.
//
// legacyId is the account's MongoDB-style id (legacy_mongo_id). Until comments and contributions move
// (Step 4) they store account ids as MongoDB ObjectIds, so session tokens carry legacyId, not the
// uuid. Copied accounts keep their old _id; accounts created here get a new ObjectId.
const { Types } = require('mongoose');
const { fromPostgresError } = require('../errors');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Account fields as stored in columns (alertPreferences is two columns, handled separately)
const COLUMN_OF = {
  username: 'username',
  email: 'email',
  password: 'password_hash',
  roles: 'roles',
  passwordPolicyVersion: 'password_policy_version',
  passwordUpdatedAt: 'password_updated_at',
  passwordResetTokenId: 'password_reset_token_id',
  passwordResetIssuedAt: 'password_reset_issued_at',
  passwordResetUsedAt: 'password_reset_used_at',
  isApproved: 'is_approved',
  ringserverUrl: 'ringserver_url',
  ringserverPort: 'ringserver_port',
};

// A field MongoDB never set came back undefined there; PostgreSQL has null. Keep undefined, so
// responses built from accounts leave the same fields out.
const opt = (value) => (value === null ? undefined : value);

// null when there's no row, as the MongoDB repository returns
const toAccount = (row) => (!row ? null : {
  id: row.id,
  legacyId: row.legacy_mongo_id ? row.legacy_mongo_id.trim() : null,
  username: row.username,
  email: row.email,
  password: row.password_hash,
  roles: row.roles || [],
  passwordPolicyVersion: row.password_policy_version,
  passwordUpdatedAt: opt(row.password_updated_at),
  passwordResetTokenId: opt(row.password_reset_token_id),
  passwordResetIssuedAt: opt(row.password_reset_issued_at),
  passwordResetUsedAt: opt(row.password_reset_used_at),
  isApproved: row.is_approved,
  ringserverUrl: opt(row.ringserver_url),
  ringserverPort: opt(row.ringserver_port),
  alertPreferences: {
    rshakeEmailEnabled: row.rshake_email_enabled,
    updatedAt: opt(row.alert_prefs_updated_at),
  },
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// Account fields -> columns. undefined clears a field (as in MongoDB), except email/password fields
// the caller didn't pass at all.
const toColumns = (fields) => {
  const row = {};
  Object.entries(fields).forEach(([field, value]) => {
    if (field === 'alertPreferences') {
      row.rshake_email_enabled = Boolean(value?.rshakeEmailEnabled);
      row.alert_prefs_updated_at = value?.updatedAt ?? null;
    } else if (COLUMN_OF[field]) {
      row[COLUMN_OF[field]] = value === undefined ? null : value;
    }
  });
  if (typeof row.email === 'string') row.email = row.email.trim().toLowerCase();
  return row;
};

// `db` is a Knex instance (src/db/knex.js in the app, a test container's in integration tests).
// Functions that take { tx } run on that Knex transaction (postgres/transactions.js).
const createAccountsRepo = (db) => {
  const select = (q) => q.select('*', db.raw('roles::text[] AS roles'));
  const one = async (where, tx) => toAccount(await select((tx || db)('accounts')).where(where).first());

  async function findByUsername(username, { role } = {}) {
    const query = select(db('accounts')).where({ username });
    if (role) query.whereRaw('?::account_role = ANY(roles)', [role]);
    return toAccount(await query.first());
  }

  const findByEmail = (email) => one({ email });
  const findByUsernameAndEmail = (username, email) => one({ username, email });
  const findByRingserverUrl = (ringserverUrl) => one({ ringserver_url: ringserverUrl });

  // Resolves to null for an id that isn't one of this table's (e.g. an old MongoDB id)
  async function findById(id, { tx } = {}) {
    if (!UUID.test(String(id))) return null;
    return one({ id }, tx);
  }

  async function create(fields) {
    let id;
    try {
      [{ id }] = await db('accounts')
        .insert({ ...toColumns(fields), legacy_mongo_id: new Types.ObjectId().toString() })
        .returning('id');
    } catch (err) {
      throw fromPostgresError(err);
    }
    return one({ id });
  }

  async function update(id, changes, { tx } = {}) {
    if (!UUID.test(String(id))) return null;
    const columns = toColumns(changes);
    if (Object.keys(columns).length === 0) return findById(id, { tx });
    let updated;
    try {
      updated = await (tx || db)('accounts').where({ id }).update(columns);
    } catch (err) {
      throw fromPostgresError(err);
    }
    return updated === 0 ? null : one({ id }, tx);
  }

  async function remove(id) {
    if (!UUID.test(String(id))) return;
    await db('accounts').where({ id }).del();
  }

  // Approved brgy accounts: [{ username, ringserverUrl, ringserverPort }] (fields an account lacks left out)
  async function listApprovedRingserverHosts() {
    const rows = await db('accounts')
      .select('username', 'ringserver_url', 'ringserver_port')
      .whereRaw("'brgy' = ANY(roles)")
      .where('is_approved', true)
      .orderBy([{ column: 'created_at' }, { column: 'id' }]);
    return rows.map((row) => {
      const host = { username: row.username };
      if (row.ringserver_url !== null) host.ringserverUrl = row.ringserver_url;
      if (row.ringserver_port !== null) host.ringserverPort = row.ringserver_port;
      return host;
    });
  }

  // The ringserver reported this sensor account connected: updated_at moves to now (set by the
  // trigger). No-op for an unknown username.
  async function recordRingserverConnection(username) {
    await db('accounts').where({ username }).update({ updated_at: db.fn.now() });
  }

  return {
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
};

module.exports = { createAccountsRepo };
