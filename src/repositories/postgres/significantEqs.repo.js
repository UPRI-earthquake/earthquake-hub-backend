// Significant earthquakes in PostgreSQL (`significant_eqs` table): the implementation used when
// SIGNIFICANT_EQS_DB=postgres. Keep it behaving like mongodb/significantEqs.repo.js: both must pass
// __tests__/significantEqs.repo.integration.test.js, and the API responses must match __tests__/golden/.
const { Types } = require('mongoose');

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COLUMNS = [
  'id', 'legacy_mongo_id', 'title', 'magnitude', 'longitude', 'latitude', 'depth_km', 'location_text',
  'event_time', 'instrument_recordings', 'event_summary', 'reference_links',
];

// Back to the shape MongoDB returned, so the API and frontend don't change: same field names and
// order, `_id` is the old MongoDB id for copied rows (old links keep working) and the uuid for new
// ones, and optional fields that are empty are left out, as they were when a document lacked them.
const toApi = (row) => {
  const eq = {
    _id: row.legacy_mongo_id || row.id,
    title: row.title,
    magnitude: row.magnitude,
    longitude: row.longitude,
    latitude: row.latitude,
  };
  if (row.depth_km !== null) eq.depth = row.depth_km;
  if (row.location_text !== null) eq.location = row.location_text;
  eq.eventTime = row.event_time;
  eq.instrumentRecordings = row.instrument_recordings;
  if (row.event_summary !== null) eq.eventSummary = row.event_summary;
  eq.references = row.reference_links;
  return eq;
};

// `db` is a Knex instance (src/db/knex.js in the app, a test container's in integration tests)
const createSignificantEqsRepo = (db) => {
  // A new uuid, or anything MongoDB accepted as an id (kept so "invalid id" answers don't change)
  const isValidId = (id) => UUID.test(String(id)) || Types.ObjectId.isValid(id);

  async function findAll() {
    const rows = await db('significant_eqs')
      .select(COLUMNS)
      // The order MongoDB returned them in (the order they were added), so the page doesn't change.
      // Copied rows have created_at from their ObjectId (whole seconds); the legacy id, which
      // embeds a counter, orders records added within the same second.
      .orderBy([
        { column: 'created_at', order: 'asc' },
        { column: 'legacy_mongo_id', order: 'asc', nulls: 'last' },
        { column: 'id', order: 'asc' },
      ]);
    return rows.map(toApi);
  }

  // Accepts the old 24-character MongoDB id (copied rows) or the uuid. Resolves to null when none matches.
  async function findById(id) {
    const query = db('significant_eqs').select(COLUMNS).first();
    if (typeof id === 'string' && OBJECT_ID.test(id)) {
      query.where('legacy_mongo_id', id.toLowerCase());
    } else if (typeof id === 'string' && UUID.test(id)) {
      query.where('id', id);
    } else {
      return null;
    }
    const row = await query;
    return row ? toApi(row) : null;
  }

  return {
    isValidId,
    findAll,
    findById,
  };
};

module.exports = { createSignificantEqsRepo };
