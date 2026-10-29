// Copies earthquake events from MongoDB to PostgreSQL: `events`, and what MongoDB embedded in each
// event, into `event_stations`, `event_catalog_matches` and `event_catalog_status`. Safe to run more
// than once: events are matched by legacy_mongo_id (the MongoDB _id).
//
//   1. Events. Skipped and reported: no publicID; a publicID another MongoDB event also has (all of
//      them, since picking one would be a guess) or that a different PostgreSQL event already has; a
//      type longer than 10 characters. Events with missing or out-of-range coordinates are copied with
//      no location, and reported.
//   2. Each copied event's stations: candidateStations (or, on older records without them,
//      onlineStations) and recordingStations, each code mapped to its device by devices.station.
//      Codes that match no device, or several, are reported and left out. onlineStations isn't stored
//      (it's worked out from these rows when reading), so events whose stored list would come out
//      differently are reported.
//   3. Each copied event's catalog matches (additionalInformation[]), one per catalog. Entries from an
//      unknown catalog are reported and left out; a catalog listed twice keeps its last entry. Fields
//      without a column, or of an unexpected type, are kept in `extra`.
//   4. Each copied event's enrichment status: one row per searched catalog (PHIVOLCS, USGS), from
//      pendingCatalogSources, catalogEnrichmentStatus/Attempts and the legacy upForEnrichment/
//      enrichmentAttempts. Events with no enrichment tracking at all get pending rows, so the nightly
//      job finds them after the switch.
//   5. Checks that every copyable event has its row, that its stations, matches and status rows are
//      all there, and that the counts add up.
//
// An event and its stations, matches and status rows are copied as one unit: an event changed in
// PostgreSQL since it was copied (newer updated_at) is kept with all its rows, so re-running after the
// switch never overwrites newer data. For that, the PostgreSQL events repository must move an event's
// updated_at whenever it writes one of its rows. Copy devices first (copy-people-and-sensors-to-postgres.js).
//
//   dry run (no changes): docker exec -w /app earthquake-hub-backend-dev npm run db:pg:copy-earthquakes -- --dry-run
//   copy:                 docker exec -w /app earthquake-hub-backend-dev npm run db:pg:copy-earthquakes
//
// Exit code: 0 = done (or dry run), 1 = validation failed, 2 = error. Skipped records alone don't fail it.
try { require('dotenv/config'); } catch (_) { /* prod images don't ship dotenv; env comes from compose */ }
const mongoose = require('mongoose');
const {
  chunk, toDate, upsertByLegacyId, copiedUpdatedAt, idsByLegacyId, missingLegacyIds,
} = require('./lib/pgCopy');

const RECORDING_STATUSES = new Set(['pending', 'partial', 'verified', 'unavailable']);
const MATCH_SOURCES = new Set(['phivolcs', 'usgs', 'upri-legacy']);
const SEARCHED_SOURCES = ['phivolcs', 'usgs']; // the catalogs the enrichment job searches
const ENRICHMENT_STATUSES = new Set(['pending', 'done', 'no_match', 'failed']);
const MATCH_QUALITIES = new Set(['high', 'medium', 'low']);
const positiveNumberEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
// Same settings the app uses (src/services/EQevents.service.js)
const MAX_ENRICHMENT_ATTEMPTS = Number(process.env.MAX_ENRICHMENT_ATTEMPTS || 3);
const RECORDING_GRACE_PERIOD_MS = positiveNumberEnv('RECORDING_AVAILABILITY_GRACE_PERIOD_MS', 30 * 60 * 1000);

// Columns overwritten when a copied event is refreshed (everything but the ids)
const EVENT_COLUMNS = [
  'public_id', 'source_catalog', 'source_server', 'source_seiscomp_version', 'is_legacy_record', 'legacy_imported_at',
  'legacy_source_public_id', 'origin_time', 'latitude', 'longitude', 'depth_km', 'magnitude', 'seiscomp_type',
  'region_text', 'place', 'recording_status', 'recording_checked_at', 'recording_attempts', 'last_modification',
  'summary_override_text', 'summary_override_edited_at', 'summary_override_edited_by', 'created_at', 'updated_at',
];

const isMissing = (value) => value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
const textOrNull = (value) => (isMissing(value) ? null : String(value));
// Numbers, or numeric strings as Mongoose would have cast them
const toNumber = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
};
const label = (doc) => `${doc._id}${doc.publicID ? ` (${doc.publicID})` : ''}`;

// --- Events ---

const eventProblem = (doc) => {
  if (isMissing(doc.publicID)) return 'no publicID';
  if (typeof doc.type === 'string' && doc.type.length > 10) return `type ${JSON.stringify(doc.type)} longer than 10 characters`;
  return null;
};

const hasValidCoordinates = (doc) => {
  const latitude = toNumber(doc.latitude_value);
  const longitude = toNumber(doc.longitude_value);
  return latitude !== null && longitude !== null && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
};

const toEventRow = (doc) => {
  const createdAt = toDate(doc.createdAt) || doc._id.getTimestamp();
  const summaryText = textOrNull(doc.summaryOverride?.text);
  const attempts = toNumber(doc.recordingAvailabilityAttempts);
  return {
    legacy_mongo_id: String(doc._id),
    public_id: String(doc.publicID),
    source_catalog: textOrNull(doc.sourceCatalog) || 'upri-current',
    source_server: textOrNull(doc.sourceServer),
    source_seiscomp_version: textOrNull(doc.sourceSeiscompVersion),
    is_legacy_record: Boolean(doc.isLegacyRecord),
    legacy_imported_at: toDate(doc.legacyImportedAt),
    legacy_source_public_id: textOrNull(doc.legacySourcePublicID),
    origin_time: toDate(doc.OT),
    latitude: toNumber(doc.latitude_value),
    longitude: toNumber(doc.longitude_value),
    depth_km: toNumber(doc.depth_value),
    magnitude: toNumber(doc.magnitude_value),
    seiscomp_type: textOrNull(doc.type),
    region_text: textOrNull(doc.text),
    place: textOrNull(doc.place),
    recording_status: RECORDING_STATUSES.has(doc.recordingAvailabilityStatus) ? doc.recordingAvailabilityStatus : 'pending',
    recording_checked_at: toDate(doc.recordingAvailabilityCheckedAt),
    recording_attempts: attempts !== null && attempts > 0 ? Math.floor(attempts) : 0,
    last_modification: toDate(doc.last_modification),
    summary_override_text: summaryText,
    summary_override_edited_at: summaryText ? toDate(doc.summaryOverride.editedAt) : null,
    summary_override_edited_by: summaryText ? textOrNull(doc.summaryOverride.editedBy) : null,
    created_at: createdAt,
    updated_at: toDate(doc.updatedAt) || createdAt,
  };
};

// --- Stations ---

// Upper-cased, trimmed, without blanks or repeats: how the app treats station lists
const normalizeStations = (list) => {
  const seen = new Set();
  return (Array.isArray(list) ? list : [])
    .map((station) => String(station ?? '').trim().toUpperCase())
    .filter((station) => station && !seen.has(station) && seen.add(station));
};

// onlineStations as the app works it out from the candidate and recording lists (the same rule as
// resolveRecordingDisplayStations in src/services/EQevents.service.js)
const displayStations = (status, candidates, recording, withinGracePeriod) => {
  if (status === 'pending') return candidates;
  if (status === 'partial' && withinGracePeriod) return normalizeStations([...recording, ...candidates]);
  if (status === 'partial' || status === 'verified') return recording;
  return [];
};

// Device ids by station code, from the devices already in PostgreSQL
async function devicesByStation(db) {
  const byStation = new Map();
  const rows = await db('devices').select('id', 'station');
  rows.forEach((row) => {
    const station = row.station.trim().toUpperCase();
    byStation.set(station, [...(byStation.get(station) || []), row.id]);
  });
  return byStation;
}

// --- Catalog matches ---

// additionalInformation entries, keyed by catalog, as the app reads them (an array; once an object)
const catalogEntries = (additionalInformation) => {
  if (Array.isArray(additionalInformation)) {
    return additionalInformation.filter((entry) => entry && typeof entry === 'object');
  }
  if (additionalInformation && typeof additionalInformation === 'object') {
    return Object.entries(additionalInformation)
      .filter(([, value]) => value && typeof value === 'object')
      .map(([source, value]) => ({ source, ...value }));
  }
  return [];
};

// Entry key -> [column, type]; anything else (or of another type) goes in `extra`
const MATCH_FIELDS = {
  sourceLabel: ['source_label', 'text'],
  sourceIconUrl: ['source_icon_url', 'text'],
  id: ['external_id', 'text'],
  title: ['title', 'text'],
  place: ['place', 'text'],
  location: ['location_text', 'text'],
  detail: ['detail', 'text'],
  url: ['url', 'text'],
  detailUrl: ['detail_url', 'text'],
  queryUrl: ['query_url', 'text'],
  time: ['match_time', 'date'],
  dateTime: ['match_time_text', 'text'],
  latitude: ['latitude', 'number'],
  longitude: ['longitude', 'number'],
  depthKm: ['depth_km', 'number'],
  magnitude: ['magnitude', 'number'],
  hasFeltIntensity: ['has_felt_intensity', 'boolean'],
  distanceKm: ['distance_km', 'number'],
  timeDifferenceMinutes: ['time_difference_minutes', 'number'],
  magnitudeDifference: ['magnitude_difference', 'number'],
  latitudeFloorMatch: ['latitude_floor_match', 'boolean'],
  longitudeFloorMatch: ['longitude_floor_match', 'boolean'],
  score: ['score', 'number'],
};

const asType = (value, type) => {
  if (value === null) return null;
  if (type === 'text') return typeof value === 'string' ? value : undefined;
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  if (type === 'boolean') return typeof value === 'boolean' ? value : undefined;
  const date = value instanceof Date || typeof value === 'string' ? toDate(value) : null; // 'date'
  return date || undefined;
};

const toMatchRow = (entry, source, eventId, eventRow) => {
  const row = { event_id: eventId, source, created_at: eventRow.created_at, updated_at: eventRow.updated_at };
  const extra = {};
  Object.entries(entry).forEach(([key, value]) => {
    if (key === 'source' || value === undefined) return;
    if (key === 'raw') {
      row.raw = value === null ? null : JSON.stringify(value);
    } else if (key === 'matchQuality' && MATCH_QUALITIES.has(value)) {
      row.match_quality = value;
    } else if (MATCH_FIELDS[key] && asType(value, MATCH_FIELDS[key][1]) !== undefined) {
      row[MATCH_FIELDS[key][0]] = asType(value, MATCH_FIELDS[key][1]);
    } else {
      extra[key] = value;
    }
  });
  // USGS entries say `depth`; PHIVOLCS and legacy ones `depthKm`. Both go in depth_km.
  if (row.depth_km === undefined && typeof extra.depth === 'number' && Number.isFinite(extra.depth)) {
    row.depth_km = extra.depth;
    delete extra.depth;
  }
  row.extra = JSON.stringify(extra);
  return row;
};

// --- Enrichment status ---

/***************************************************************************
  * toStatusRows:
  *     One row per searched catalog, from the bookkeeping MongoDB kept on the event:
  *       - in pendingCatalogSources: pending
  *       - else its catalogEnrichmentStatus entry, if it's a known status
  *       - else (older records) done if a match exists, no_match if the legacy upForEnrichment flag
  *         says enrichment finished, failed if its legacy attempts ran out, and pending otherwise
  *         (also when the event has no tracking at all: enrichment never started)
  *     Attempts: the catalog's catalogEnrichmentAttempts entry, else the legacy enrichmentAttempts
  *     counter (enrichment passes over the whole event).
  *
  * Returns:
  *     { rows, fromLegacyCounter, untracked, unknownStatuses: [string] }
  ***************************************************************************/
const toStatusRows = (doc, eventId, matchedSources, updatedAt) => {
  const pending = new Set(normalizeStations(doc.pendingCatalogSources).map((source) => source.toLowerCase()));
  const statusMap = doc.catalogEnrichmentStatus && typeof doc.catalogEnrichmentStatus === 'object' ? doc.catalogEnrichmentStatus : {};
  const attemptsMap = doc.catalogEnrichmentAttempts && typeof doc.catalogEnrichmentAttempts === 'object' ? doc.catalogEnrichmentAttempts : {};
  const legacyAttempts = Math.max(0, Math.floor(toNumber(doc.enrichmentAttempts) || 0));
  const untracked = doc.pendingCatalogSources === undefined && Object.keys(statusMap).length === 0
    && doc.upForEnrichment === undefined && doc.enrichmentAttempts === undefined;
  let fromLegacyCounter = false;
  const unknownStatuses = [];

  const rows = SEARCHED_SOURCES.map((source) => {
    let status;
    if (pending.has(source)) status = 'pending';
    else if (ENRICHMENT_STATUSES.has(statusMap[source])) status = statusMap[source];
    else {
      if (statusMap[source] !== undefined) unknownStatuses.push(`${source}: ${JSON.stringify(statusMap[source])}`);
      if (matchedSources.has(source)) status = 'done';
      else if (doc.upForEnrichment === false) status = 'no_match';
      else if (doc.upForEnrichment === true && legacyAttempts >= MAX_ENRICHMENT_ATTEMPTS) status = 'failed';
      else status = 'pending';
    }

    let attempts = toNumber(attemptsMap[source]);
    if (attempts === null) {
      attempts = untracked ? 0 : legacyAttempts;
      if (!untracked && legacyAttempts > 0) fromLegacyCounter = true;
    }
    return { event_id: eventId, source, status, attempts: Math.max(0, Math.floor(attempts)), updated_at: updatedAt };
  });

  return { rows, fromLegacyCounter, untracked, unknownStatuses };
};

// Rows per event already in `table`, for these events: Map(eventId -> count)
async function rowCounts(db, table, eventIds) {
  const counts = new Map();
  for (const batch of chunk(eventIds)) {
    const rows = await db(table).select('event_id').count({ n: '*' }).whereIn('event_id', batch).groupBy('event_id');
    rows.forEach((row) => counts.set(row.event_id, Number(row.n)));
  }
  return counts;
}

/***************************************************************************
  * copyEarthquakes:
  *     Copies MongoDB events with their stations, catalog matches and enrichment status to PostgreSQL
  *     (see the steps at the top of this file). Expects Mongoose to be connected already.
  *
  * Inputs:
  *     db:      Knex instance for PostgreSQL
  *     dryRun:  report what would change without writing
  *     log:     function for progress lines (default console.log)
  *
  * Outputs:
  *     { ok, events, stations, matches, status }:
  *       events:   { mongoTotal, skipped: [{ id, reason }], inserted, updated, keptNewer,
  *                   noLocation: [id], missing: [id] }
  *       stations: { mongoTotal, written, keptWithEvent, unmatched: [{ id, station, kind }],
  *                   ambiguous: [...], fromOnlineStations: [id], onlineStationsDiffer: [{ id, stored, shown }] }
  *       matches:  { mongoTotal, written, keptWithEvent, unknownSource: [{ id, source }], duplicates: [{ id, source }] }
  *       status:   { written, keptWithEvent, fromLegacyCounter: [id], untracked: [id], unknownStatuses: [{ id, values }] }
  *     plus `incomplete: [id]` on each child table: copied events whose rows didn't all arrive.
  ***************************************************************************/
async function copyEarthquakes({ db, dryRun = false, log = console.log }) {
  const now = Date.now();
  const eventDocs = await mongoose.connection.collection('events').find({}).toArray();

  // 1. Events
  const eventsSkipped = [];
  let candidates = [];
  eventDocs.forEach((doc) => {
    const reason = eventProblem(doc);
    if (reason) eventsSkipped.push({ id: label(doc), reason });
    else candidates.push(doc);
  });

  const byPublicId = new Map();
  candidates.forEach((doc) => byPublicId.set(String(doc.publicID), [...(byPublicId.get(String(doc.publicID)) || []), doc]));
  candidates = candidates.filter((doc) => {
    const group = byPublicId.get(String(doc.publicID));
    if (group.length === 1) return true;
    const others = group.filter((other) => other !== doc).map((other) => String(other._id));
    eventsSkipped.push({ id: label(doc), reason: `same publicID as ${others.join(', ')}` });
    return false;
  });

  // publicIDs PostgreSQL already holds under another row (e.g. an event SeisComP sent after the switch)
  const takenPublicIds = new Map();
  for (const batch of chunk(candidates.map((doc) => String(doc.publicID)))) {
    const rows = await db('events').select('public_id', 'legacy_mongo_id').whereIn('public_id', batch);
    rows.forEach((row) => takenPublicIds.set(row.public_id, (row.legacy_mongo_id || '').trim()));
  }
  candidates = candidates.filter((doc) => {
    const holder = takenPublicIds.get(String(doc.publicID));
    if (holder === undefined || holder === String(doc._id)) return true;
    eventsSkipped.push({ id: label(doc), reason: 'publicID already used by another PostgreSQL event' });
    return false;
  });

  const eventRows = candidates.map(toEventRow);
  const noLocation = candidates.filter((doc) => !hasValidCoordinates(doc)).map(label);

  // Events changed in PostgreSQL since they were copied keep their rows; the rest get theirs rewritten
  const copiedAt = await copiedUpdatedAt(db, 'events', eventRows.map((row) => row.legacy_mongo_id));
  const keptIds = new Set(eventRows
    .filter((row) => copiedAt.has(row.legacy_mongo_id) && copiedAt.get(row.legacy_mongo_id) > row.updated_at)
    .map((row) => row.legacy_mongo_id));
  const eventCounts = await upsertByLegacyId({ db, table: 'events', rows: eventRows, columns: EVENT_COLUMNS, dryRun });
  const eventIds = dryRun ? new Map() : await idsByLegacyId(db, 'events', eventRows.map((row) => row.legacy_mongo_id));

  // 2-4. Each event's stations, matches and status
  const byStation = await devicesByStation(db);
  const stations = { mongoTotal: 0, written: 0, keptWithEvent: 0, unmatched: [], ambiguous: [], fromOnlineStations: [], onlineStationsDiffer: [] };
  const matches = { mongoTotal: 0, written: 0, keptWithEvent: 0, unknownSource: [], duplicates: [] };
  const status = { written: 0, keptWithEvent: 0, fromLegacyCounter: [], untracked: [], unknownStatuses: [] };
  const units = []; // { eventId, legacyId, stationRows, matchRows, statusRows } for events whose rows are rewritten

  candidates.forEach((doc, i) => {
    const eventRow = eventRows[i];
    const legacyId = eventRow.legacy_mongo_id;
    const kept = keptIds.has(legacyId);
    const eventId = eventIds.get(legacyId) || null;

    // Stations
    const hasCandidates = Array.isArray(doc.candidateStations) && doc.candidateStations.length > 0;
    const candidateCodes = normalizeStations(hasCandidates ? doc.candidateStations : doc.onlineStations);
    if (!hasCandidates && candidateCodes.length > 0) stations.fromOnlineStations.push(label(doc));
    const recordingCodes = normalizeStations(doc.recordingStations);
    const stationRows = [];
    const mapped = { candidate: [], recording: [] };
    [['candidate', candidateCodes], ['recording', recordingCodes]].forEach(([kind, codes]) => {
      codes.forEach((code, position) => {
        stations.mongoTotal += 1;
        const devices = byStation.get(code) || [];
        if (devices.length === 0) stations.unmatched.push({ id: label(doc), station: code, kind });
        else if (devices.length > 1) stations.ambiguous.push({ id: label(doc), station: code, kind });
        else {
          stationRows.push({ event_id: eventId, device_id: devices[0], kind, position });
          mapped[kind].push(code);
        }
      });
    });
    const withinGracePeriod = now - (eventRow.origin_time ? eventRow.origin_time.getTime() : 0) < RECORDING_GRACE_PERIOD_MS;
    const shown = displayStations(eventRow.recording_status, mapped.candidate, mapped.recording, withinGracePeriod);
    const stored = normalizeStations(doc.onlineStations);
    if (JSON.stringify(shown) !== JSON.stringify(stored)) stations.onlineStationsDiffer.push({ id: label(doc), stored, shown });

    // Catalog matches: the last entry per catalog
    const bySource = new Map();
    catalogEntries(doc.additionalInformation).forEach((entry) => {
      matches.mongoTotal += 1;
      const source = String(entry.source ?? '').toLowerCase();
      if (!MATCH_SOURCES.has(source)) {
        matches.unknownSource.push({ id: label(doc), source: entry.source ?? null });
        return;
      }
      if (bySource.has(source)) matches.duplicates.push({ id: label(doc), source });
      bySource.set(source, entry);
    });
    const matchRows = [...bySource.entries()].map(([source, entry]) => toMatchRow(entry, source, eventId, eventRow));

    // Enrichment status
    const derived = toStatusRows(doc, eventId, new Set(bySource.keys()), eventRow.updated_at);
    if (derived.fromLegacyCounter) status.fromLegacyCounter.push(label(doc));
    if (derived.untracked) status.untracked.push(label(doc));
    if (derived.unknownStatuses.length > 0) status.unknownStatuses.push({ id: label(doc), values: derived.unknownStatuses });

    if (kept) {
      stations.keptWithEvent += stationRows.length;
      matches.keptWithEvent += matchRows.length;
      status.keptWithEvent += derived.rows.length;
    } else {
      units.push({ eventId, legacyId, stationRows, matchRows, statusRows: derived.rows });
      stations.written += stationRows.length;
      matches.written += matchRows.length;
      status.written += derived.rows.length;
    }
  });

  if (!dryRun) {
    await db.transaction(async (trx) => {
      // Keeps the copied MongoDB updated_at on matches and status rows (see scripts/lib/pgCopy.js)
      await trx.raw("SELECT set_config('app.preserve_updated_at', 'on', true)");
      // One query at a time: a transaction runs on a single connection
      for (const batch of chunk(units)) {
        const ids = batch.map((unit) => unit.eventId);
        for (const [table, key] of [['event_stations', 'stationRows'], ['event_catalog_matches', 'matchRows'], ['event_catalog_status', 'statusRows']]) {
          await trx(table).whereIn('event_id', ids).del();
          for (const part of chunk(batch.flatMap((unit) => unit[key]))) {
            await trx(table).insert(part);
          }
        }
      }
    });
  }

  // 5. Validation: every copyable event has its row, each rewritten event has all its rows, and the
  //    counts add up
  const missing = dryRun ? [] : await missingLegacyIds(db, 'events', eventRows.map((row) => row.legacy_mongo_id));
  const incomplete = async (table, key) => {
    if (dryRun) return [];
    const counts = await rowCounts(db, table, units.map((unit) => unit.eventId));
    return units.filter((unit) => (counts.get(unit.eventId) || 0) !== unit[key].length).map((unit) => unit.legacyId);
  };
  stations.incomplete = await incomplete('event_stations', 'stationRows');
  matches.incomplete = await incomplete('event_catalog_matches', 'matchRows');
  status.incomplete = await incomplete('event_catalog_status', 'statusRows');

  const events = { mongoTotal: eventDocs.length, skipped: eventsSkipped, ...eventCounts, noLocation, missing };
  const countsAddUp = events.mongoTotal === events.skipped.length + eventRows.length
    && eventRows.length === events.inserted + events.updated + events.keptNewer
    && events.keptNewer === keptIds.size;
  const allProblems = [...missing, ...stations.incomplete, ...matches.incomplete, ...status.incomplete];
  const ok = countsAddUp && allProblems.length === 0;

  // Report
  const would = (word) => (dryRun ? `would ${word}` : { insert: 'inserted', update: 'updated', write: 'written' }[word]);
  const list = (items, format) => items.forEach((item) => log(`    ${format(item)}`));
  log(`${dryRun ? '[dry run] ' : ''}Events in MongoDB: ${events.mongoTotal}`);
  log(`  ${would('insert')}: ${events.inserted}, ${would('update')}: ${events.updated}, kept with their rows (changed in PostgreSQL since copied): ${events.keptNewer}`);
  log(`  skipped: ${events.skipped.length}`);
  list(events.skipped, ({ id, reason }) => `${id}: ${reason}`);
  log(`  copied with no location (missing or out-of-range coordinates): ${noLocation.length}`);
  list(noLocation, (id) => id);
  log(`Station entries in MongoDB: ${stations.mongoTotal}`);
  log(`  ${would('write')}: ${stations.written}, kept with their event: ${stations.keptWithEvent}`);
  log(`  left out, no device with that station: ${stations.unmatched.length}`);
  list(stations.unmatched, ({ id, station, kind }) => `${id}: ${station} (${kind})`);
  log(`  left out, several devices with that station: ${stations.ambiguous.length}`);
  list(stations.ambiguous, ({ id, station, kind }) => `${id}: ${station} (${kind})`);
  log(`  candidates taken from onlineStations (older records): ${stations.fromOnlineStations.length}`);
  log(`  onlineStations that will show differently: ${stations.onlineStationsDiffer.length}`);
  list(stations.onlineStationsDiffer, ({ id, stored, shown }) => `${id}: stored [${stored.join(', ')}], will show [${shown.join(', ')}]`);
  log(`Catalog matches in MongoDB: ${matches.mongoTotal}`);
  log(`  ${would('write')}: ${matches.written}, kept with their event: ${matches.keptWithEvent}`);
  log(`  left out, unknown catalog: ${matches.unknownSource.length}`);
  list(matches.unknownSource, ({ id, source }) => `${id}: ${JSON.stringify(source)}`);
  log(`  left out, catalog listed twice (last entry kept): ${matches.duplicates.length}`);
  list(matches.duplicates, ({ id, source }) => `${id}: ${source}`);
  log(`Enrichment status rows (one per event per searched catalog): ${would('write')}: ${status.written}, kept with their event: ${status.keptWithEvent}`);
  log(`  attempts taken from the legacy enrichmentAttempts counter: ${status.fromLegacyCounter.length} events`);
  log(`  no enrichment tracking (pending, so the nightly job picks them up): ${status.untracked.length} events`);
  list(status.untracked, (id) => id);
  log(`  unknown status values (worked out from the other fields): ${status.unknownStatuses.length}`);
  list(status.unknownStatuses, ({ id, values }) => `${id}: ${values.join('; ')}`);
  if (!dryRun) {
    log(allProblems.length === 0
      ? 'Validation passed: every copyable event and its stations, matches and status rows are in PostgreSQL.'
      : `Validation FAILED: missing rows for ${[...new Set(allProblems)].join(', ')}`);
  }
  if (!countsAddUp) log('Validation FAILED: counts do not add up.');

  return { ok, events, stations, matches, status };
}

module.exports = { copyEarthquakes };

if (require.main === module) {
  const { connectOrThrow } = require('./find-duplicates');
  const postgres = require('../src/db/knex');
  const dryRun = process.argv.includes('--dry-run');

  connectOrThrow()
    .then(() => copyEarthquakes({ db: postgres.db, dryRun }))
    .then(async ({ ok }) => {
      await mongoose.disconnect();
      await postgres.db.destroy();
      process.exit(ok ? 0 : 1);
    })
    .catch(async (err) => {
      console.error(`copy-earthquakes-to-postgres failed: ${err.message}`);
      await mongoose.disconnect().catch(() => {});
      await postgres.db.destroy().catch(() => {});
      process.exit(2);
    });
}
