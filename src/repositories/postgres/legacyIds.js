// Callers (services, session tokens, other repositories) still name accounts and events by their
// MongoDB-style id (legacy_mongo_id): these find the PostgreSQL row for such an id. A row's own uuid is
// accepted too, for rows that have no legacy id.
const OBJECT_ID = /^[0-9a-f]{24}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isUuid = (value) => typeof value === 'string' && UUID.test(value);

// Rows of `table` with this MongoDB-style id (or uuid), as a query to filter on
const byLegacyId = (k, table, value) => {
  const text = value === null || value === undefined ? '' : String(value).trim();
  if (OBJECT_ID.test(text)) return k(table).select('id').where('legacy_mongo_id', text.toLowerCase());
  if (isUuid(text)) return k(table).select('id').where('id', text);
  return null;
};

// accounts.id for a MongoDB-style account id, or null when there's no such account
async function accountIdFor(k, value) {
  const query = byLegacyId(k, 'accounts', value);
  return query ? (await query.first())?.id || null : null;
}

// events.id for an event named by its MongoDB-style id, else by its publicID; null when neither matches
async function eventIdFor(k, { _id, publicID } = {}) {
  const query = byLegacyId(k, 'events', _id);
  const byId = query ? (await query.first())?.id : null;
  if (byId) return byId;
  const publicId = typeof publicID === 'string' ? publicID.trim() : '';
  return publicId ? (await k('events').select('id').where('public_id', publicId).first())?.id || null : null;
}

// The MongoDB-style id a row shows: its legacy_mongo_id, or its uuid when it has none
const shownId = (legacyMongoId, id) => (legacyMongoId ? legacyMongoId.trim() : id);

module.exports = {
  isUuid,
  byLegacyId,
  accountIdFor,
  eventIdFor,
  shownId,
};
