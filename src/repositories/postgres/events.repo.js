// Earthquake events in PostgreSQL: the same functions and event shape as mongodb/events.repo.js, which
// both must keep (__tests__/events.repo.integration.test.js). Events come back in the shape the API
// sends (`_id`, OT, latitude_value, ...), put together from four tables:
//   events                  the event; `_id` is legacy_mongo_id: copied events keep their old _id, new
//                           ones get a new ObjectId, so comments (still on MongoDB) keep finding them
//   event_stations          candidateStations / recordingStations, as the devices' station codes
//   event_catalog_matches   additionalInformation[], in its order
//   event_catalog_status    pendingCatalogSources, catalogEnrichmentStatus / Attempts, and the legacy
//                           upForEnrichment / enrichmentAttempts, worked out from the rows
// onlineStations isn't stored: it's worked out when reading, with the rule the station check uses
// (eventMappings.displayStations). Station codes that match no device can't be stored and are left out.
//
// Writes that touch several tables run in one transaction, and every write to an event's rows also
// moves the event's updated_at, so the copy script can treat an event and its rows as one unit.
const { Types } = require('mongoose');
const { normalizeStations, displayStations, toMatchColumns, toCatalogEntry } = require('./eventMappings');

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEARCHED_SOURCES = ['phivolcs', 'usgs']; // the catalogs the enrichment job searches, in its order
const MATCH_SOURCES = ['phivolcs', 'usgs', 'upri-legacy'];
const ENRICHMENT_STATUSES = new Set(['pending', 'done', 'no_match', 'failed']);
// Values that mean "no place name yet": a computed one may replace them (null included)
const PLACES_TO_REPLACE = ['', 'Unavailable', 'Unable to geocode', 'Nominatim unavailable'];
const STATION_CHECK_KEYS = [
  '_id', 'OT', 'latitude_value', 'longitude_value', 'candidateStations', 'onlineStations',
  'recordingAvailabilityAttempts', 'recordingAvailabilityStatus',
];

const positiveNumberEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
const toDate = (value) => {
  if (value === null || value === undefined) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};
const toNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const pick = (object, keys) => Object.fromEntries(keys.filter((key) => object[key] !== undefined).map((key) => [key, object[key]]));

// `db` is a Knex instance (src/db/knex.js in the app, a test container's in integration tests).
// The settings default to the ones the app uses (src/services/EQevents.service.js).
const createEventsRepo = (db, {
  gracePeriodMs = positiveNumberEnv('RECORDING_AVAILABILITY_GRACE_PERIOD_MS', 30 * 60 * 1000),
  maxEnrichmentAttempts = Number(process.env.MAX_ENRICHMENT_ATTEMPTS || 3),
} = {}) => {
  // --- Reading ---

  // An events row, its station codes, matches and status rows -> the event as the API sends it.
  // Optional fields that are empty are left out, as when a MongoDB document lacked them; the legacy
  // fields stay as null, as SeisComP ingest stores them.
  const toEvent = (row, { stations = [], matches = [], statuses = [] } = {}) => {
    const codes = (kind) => stations.filter((station) => station.kind === kind).map((station) => station.station);
    const candidateStations = codes('candidate');
    const recordingStations = codes('recording');
    const withinGracePeriod = Boolean(row.origin_time) && Date.now() - row.origin_time.getTime() < gracePeriodMs;
    const statusOf = new Map(statuses.map((status) => [status.source, status]));
    // A catalog without a status row counts as pending, as MongoDB's default list did
    const pendingCatalogSources = SEARCHED_SOURCES.filter((source) => {
      const status = statusOf.get(source);
      return !status || (status.status === 'pending' && status.attempts < maxEnrichmentAttempts);
    });
    const hasLocation = row.latitude !== null && row.longitude !== null
      && row.latitude >= -90 && row.latitude <= 90 && row.longitude >= -180 && row.longitude <= 180;

    const event = {
      _id: (row.legacy_mongo_id || '').trim() || row.id,
      publicID: row.public_id,
      sourceCatalog: row.source_catalog,
      sourceServer: row.source_server,
      sourceSeiscompVersion: row.source_seiscomp_version,
      isLegacyRecord: row.is_legacy_record,
      OT: row.origin_time,
      latitude_value: row.latitude,
      longitude_value: row.longitude,
      location: hasLocation ? { type: 'Point', coordinates: [row.longitude, row.latitude] } : null,
      depth_value: row.depth_km,
      magnitude_value: row.magnitude,
      type: row.seiscomp_type,
      text: row.region_text,
      place: row.place,
      onlineStations: displayStations(row.recording_status, candidateStations, recordingStations, withinGracePeriod),
      candidateStations,
      recordingStations,
      recordingAvailabilityStatus: row.recording_status,
      recordingAvailabilityCheckedAt: row.recording_checked_at,
      recordingAvailabilityAttempts: row.recording_attempts,
      last_modification: row.last_modification,
      upForEnrichment: pendingCatalogSources.length > 0,
      enrichmentAttempts: Math.max(0, ...statuses.map((status) => status.attempts)),
      additionalInformation: [...matches].sort((a, b) => a.position - b.position).map(toCatalogEntry),
      pendingCatalogSources,
      catalogEnrichmentAttempts: Object.fromEntries(statuses.filter((s) => s.attempts > 0).map((s) => [s.source, s.attempts])),
      catalogEnrichmentStatus: Object.fromEntries(statuses.map((s) => [s.source, s.status])),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      __v: 0,
    };
    Object.keys(event).forEach((key) => {
      if (event[key] === null) delete event[key];
    });
    event.legacyImportedAt = row.legacy_imported_at;
    event.legacySourcePublicID = row.legacy_source_public_id;
    event.summaryOverride = row.summary_override_text === null ? null : {
      text: row.summary_override_text,
      ...(row.summary_override_edited_at ? { editedAt: row.summary_override_edited_at } : {}),
      ...(row.summary_override_edited_by ? { editedBy: row.summary_override_edited_by } : {}),
    };
    return event;
  };

  // events rows -> events, with their rows loaded in three queries
  async function withRows(rows) {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const [stations, matches, statuses] = await Promise.all([
      db('event_stations AS s').join('devices AS d', 'd.id', 's.device_id')
        .whereRaw('s.event_id = ANY(?)', [ids]).orderBy(['s.kind', 's.position'])
        .select('s.event_id', 's.kind', 'd.station'),
      db('event_catalog_matches').whereRaw('event_id = ANY(?)', [ids]),
      db('event_catalog_status').whereRaw('event_id = ANY(?)', [ids]),
    ]);
    const byEvent = (list) => {
      const grouped = new Map();
      list.forEach((item) => grouped.set(item.event_id, [...(grouped.get(item.event_id) || []), item]));
      return grouped;
    };
    const [stationsOf, matchesOf, statusesOf] = [byEvent(stations), byEvent(matches), byEvent(statuses)];
    return rows.map((row) => toEvent(row, {
      stations: stationsOf.get(row.id), matches: matchesOf.get(row.id), statuses: statusesOf.get(row.id),
    }));
  }

  // Events in a fixed order: by MongoDB-style id (the order MongoDB kept them in, for copied events)
  const ordered = (query) => query.orderBy([{ column: 'legacy_mongo_id', nulls: 'last' }, { column: 'id' }]);

  const findOne = async (where) => (await withRows(await db('events').where(where).limit(1)))[0] || null;

  // events.id for an event's `_id` (its MongoDB-style id, or the uuid of one that has none)
  async function eventIdOf(id, trx = db) {
    const text = String(id ?? '');
    if (OBJECT_ID.test(text)) return (await trx('events').where({ legacy_mongo_id: text.toLowerCase() }).first('id'))?.id || null;
    if (UUID.test(text)) return (await trx('events').where({ id: text }).first('id'))?.id || null;
    return null;
  }

  // Replaces one of an event's station lists; codes that match no device (or several) are left out
  async function replaceStations(trx, eventId, kind, list) {
    await trx('event_stations').where({ event_id: eventId, kind }).del();
    const codes = normalizeStations(list);
    if (codes.length === 0) return;
    const devices = await trx('devices').select('id', 'station').whereRaw('upper(station) = ANY(?)', [codes]);
    const idsByCode = new Map();
    devices.forEach((device) => {
      const code = device.station.trim().toUpperCase();
      idsByCode.set(code, [...(idsByCode.get(code) || []), device.id]);
    });
    const rows = codes
      .map((code, position) => ({ code, position }))
      .filter(({ code }) => (idsByCode.get(code) || []).length === 1)
      .map(({ code, position }) => ({ event_id: eventId, device_id: idsByCode.get(code)[0], kind, position }));
    if (rows.length > 0) await trx('event_stations').insert(rows);
  }

  // Moves the event's updated_at (the trigger stamps now() on any update)
  const touch = (trx, eventId) => trx('events').where({ id: eventId }).update({ updated_at: trx.fn.now() });

  // --- Reads ---

  async function listByOriginTime(startTime, endTime) {
    return withRows(await ordered(db('events').whereBetween('origin_time', [toDate(startTime), toDate(endTime)])));
  }

  const findByPublicID = (publicID) => findOne({ public_id: String(publicID) });

  async function findRefById(id) {
    if (!OBJECT_ID.test(String(id))) return null;
    const row = await db('events').where({ legacy_mongo_id: String(id).toLowerCase() }).first('legacy_mongo_id', 'public_id');
    return row ? { _id: row.legacy_mongo_id.trim(), publicID: row.public_id } : null;
  }

  // --- SeisComP ingest ---

  const findIngestState = (publicID) => findByPublicID(publicID);

  /***************************************************************************
    * saveFromSeiscomp:
    *     One upsert on public_id that only applies a message whose last_modification isn't older than
    *     the stored one; then the event's candidate stations, in the same transaction. A new event
    *     gets a new MongoDB-style id and a pending status row for each of `catalogSources`.
    *     Returns true when saved, false when dropped as out of order.
    ***************************************************************************/
  async function saveFromSeiscomp(publicID, fields, { clearPlace = false, catalogSources = [] } = {}) {
    const columns = {
      origin_time: toDate(fields.OT),
      latitude: toNumber(fields.latitude_value),
      longitude: toNumber(fields.longitude_value),
      depth_km: toNumber(fields.depth_value),
      magnitude: toNumber(fields.magnitude_value),
      seiscomp_type: fields.type ?? null,
      region_text: fields.text ?? null,
      source_catalog: fields.sourceCatalog || 'upri-current',
      source_server: fields.sourceServer ?? null,
      // An event SeisComP sends is current, so it's no longer a legacy import
      is_legacy_record: false,
      legacy_imported_at: null,
      legacy_source_public_id: null,
      recording_status: fields.recordingAvailabilityStatus || 'pending',
      last_modification: toDate(fields.last_modification),
    };
    if (fields.sourceSeiscompVersion) columns.source_seiscomp_version = fields.sourceSeiscompVersion;

    return db.transaction(async (trx) => {
      const merge = Object.fromEntries(Object.keys(columns).map((column) => [column, trx.raw('??', [`excluded.${column}`])]));
      // A message without last_modification keeps the stored one
      merge.last_modification = trx.raw('COALESCE(excluded.last_modification, events.last_modification)');
      if (clearPlace) merge.place = null;

      const [saved] = await trx('events')
        .insert({ ...columns, public_id: String(publicID), legacy_mongo_id: new Types.ObjectId().toString() })
        .onConflict('public_id')
        .merge(merge)
        .where(trx.raw('excluded.last_modification IS NULL OR events.last_modification IS NULL OR events.last_modification <= excluded.last_modification'))
        .returning(['id', trx.raw('(xmax = 0) AS inserted')]);
      if (!saved) return false;

      if (saved.inserted && catalogSources.length > 0) {
        await trx('event_catalog_status')
          .insert(catalogSources.filter((source) => SEARCHED_SOURCES.includes(source)).map((source) => ({ event_id: saved.id, source })))
          .onConflict(['event_id', 'source']).ignore();
      }
      await replaceStations(trx, saved.id, 'candidate', fields.candidateStations);
      return true;
    });
  }

  // --- Place names ---

  async function savePlace(event, place) {
    let where = null;
    if (event?._id) {
      const eventId = await eventIdOf(event._id);
      if (!eventId) return;
      where = { id: eventId };
    } else if (event?.publicID) {
      where = { public_id: String(event.publicID) };
    }
    if (!where) return;

    await db('events').where(where)
      .where((query) => query.whereNull('place').orWhereIn('place', PLACES_TO_REPLACE))
      .update({ place });
  }

  // --- Summary override ---

  async function setSummary(publicID, text, editedBy) {
    const updated = await db('events').where({ public_id: String(publicID) }).update({
      summary_override_text: text,
      summary_override_edited_at: new Date(),
      summary_override_edited_by: editedBy || null,
    });
    return updated > 0 ? findByPublicID(publicID) : null;
  }

  async function clearSummary(publicID) {
    const updated = await db('events').where({ public_id: String(publicID) }).update({
      summary_override_text: null, summary_override_edited_at: null, summary_override_edited_by: null,
    });
    return updated > 0 ? findByPublicID(publicID) : null;
  }

  // --- Station check ---

  async function findForStationCheck(publicID) {
    const event = await findByPublicID(publicID);
    return event ? pick(event, STATION_CHECK_KEYS) : null;
  }

  async function listForStationCheck({ after = null, limit }) {
    const query = db('events').whereNotNull('latitude').whereNotNull('longitude');
    if (after) query.where('legacy_mongo_id', '>', String(after).toLowerCase());
    const events = await withRows(await ordered(query).limit(limit));
    return events.map((event) => pick(event, STATION_CHECK_KEYS));
  }

  // Each event's results in one transaction: its recording status, attempts and checked-at time, and
  // its candidate and recording stations (onlineStations is worked out when reading). Every event
  // found counts as modified, as on MongoDB, where each save also set updatedAt.
  async function saveStationChecks(results) {
    if (results.length === 0) return { matchedCount: 0, modifiedCount: 0 };
    let matchedCount = 0;
    await db.transaction(async (trx) => {
      for (const { _id, ...fields } of results) {
        const eventId = await eventIdOf(_id, trx);
        if (!eventId) continue;
        matchedCount += 1;
        const changes = { updated_at: trx.fn.now() };
        if ('recordingAvailabilityStatus' in fields) changes.recording_status = fields.recordingAvailabilityStatus;
        if ('recordingAvailabilityCheckedAt' in fields) changes.recording_checked_at = toDate(fields.recordingAvailabilityCheckedAt);
        if ('recordingAvailabilityAttempts' in fields) changes.recording_attempts = fields.recordingAvailabilityAttempts;
        await trx('events').where({ id: eventId }).update(changes);
        if ('candidateStations' in fields) await replaceStations(trx, eventId, 'candidate', fields.candidateStations);
        if ('recordingStations' in fields) await replaceStations(trx, eventId, 'recording', fields.recordingStations);
      }
    });
    return { matchedCount, modifiedCount: matchedCount };
  }

  async function sampleOnlineStations() {
    const [event] = await withRows(await ordered(db('events')).limit(1));
    return event ? event.onlineStations : null;
  }

  // --- Catalog enrichment ---

  // Old enough, with a status row still pending and attempts left
  const enrichmentEligible = (query, { cutoff, maxAttempts }) => query
    .where('origin_time', '<=', toDate(cutoff))
    .whereExists((sub) => sub.select(1).from('event_catalog_status AS c')
      .whereRaw('c.event_id = events.id').where('c.status', 'pending').where('c.attempts', '<', maxAttempts));

  async function countEnrichmentEligible({ cutoff, maxAttempts }) {
    const { n } = await enrichmentEligible(db('events'), { cutoff, maxAttempts }).count({ n: '*' }).first();
    return Number(n);
  }

  async function listEnrichmentEligible({ cutoff, maxAttempts, limit }) {
    const rows = await enrichmentEligible(db('events'), { cutoff, maxAttempts })
      .orderBy([{ column: 'origin_time' }, { column: 'legacy_mongo_id' }]).limit(limit);
    return withRows(rows);
  }

  /***************************************************************************
    * saveEnrichment:
    *     One enrichment pass over an event, in one transaction: its matches become exactly
    *     `additionalInformation` (one per catalog), and each searched catalog's status row takes its
    *     status (from catalogEnrichmentStatus, or pending while in pendingCatalogSources) and its
    *     attempts. A catalog the pass says nothing about keeps its row.
    ***************************************************************************/
  async function saveEnrichment(id, { additionalInformation, pendingCatalogSources, catalogEnrichmentAttempts, catalogEnrichmentStatus }) {
    await db.transaction(async (trx) => {
      const eventId = await eventIdOf(id, trx);
      if (!eventId) return;

      const bySource = new Map();
      (additionalInformation || []).forEach((entry) => {
        const source = String(entry?.source ?? '').toLowerCase();
        if (MATCH_SOURCES.includes(source)) bySource.set(source, entry);
      });
      await trx('event_catalog_matches').where({ event_id: eventId }).del();
      if (bySource.size > 0) {
        await trx('event_catalog_matches').insert([...bySource.entries()]
          .map(([source, entry], position) => ({ ...toMatchColumns(entry, source, position), event_id: eventId })));
      }

      const pending = new Set((pendingCatalogSources || []).map((source) => String(source).toLowerCase()));
      for (const source of SEARCHED_SOURCES) {
        const given = catalogEnrichmentStatus?.[source];
        let status = null;
        if (ENRICHMENT_STATUSES.has(given)) status = given;
        else if (pending.has(source)) status = 'pending';
        const attempts = toNumber(catalogEnrichmentAttempts?.[source]);
        if (status === null && attempts === null) continue;

        const changes = { ...(status !== null ? { status } : {}), ...(attempts !== null ? { attempts } : {}) };
        await trx('event_catalog_status')
          .insert({ event_id: eventId, source, status: status ?? 'pending', attempts: attempts ?? 0 })
          .onConflict(['event_id', 'source'])
          .merge(changes);
      }
      await touch(trx, eventId);
    });
  }

  return {
    listByOriginTime,
    findByPublicID,
    findRefById,
    findIngestState,
    saveFromSeiscomp,
    savePlace,
    setSummary,
    clearSummary,
    findForStationCheck,
    listForStationCheck,
    saveStationChecks,
    sampleOnlineStations,
    countEnrichmentEligible,
    listEnrichmentEligible,
    saveEnrichment,
  };
};

module.exports = { createEventsRepo };
