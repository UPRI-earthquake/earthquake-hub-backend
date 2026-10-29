// Earthquake events in MongoDB (`events` collection). Step 3 adds a PostgreSQL version and the setting
// that picks between them; both must pass __tests__/events.repo.integration.test.js.
//
// Events are returned in the shape the API sends: `_id` and the field names as stored (OT,
// latitude_value, magnitude_value, onlineStations, additionalInformation, ...). Station lists are
// station codes ("R3B2D") going in and coming out, so the PostgreSQL version can store them as links
// to devices without changing callers.
//
// Reads for the API apply the model's defaults, as Mongoose documents did, so an old record missing a
// field still shows it. Reads for the background jobs return only the fields those jobs use.
const { Types } = require('mongoose');
const EQEvents = require('../../models/events.model');
const { toGeoPoint } = require('../../models/geoPoint');

const toEvent = (doc) => (doc ? doc.toObject({ flattenMaps: true }) : null);

const isObjectId = (id) => /^[0-9a-f]{24}$/i.test(String(id)) && Types.ObjectId.isValid(String(id));

// --- Reads ---

// Events whose origin time is in [startTime, endTime], newest first: the query walks the descending
// OT index (the API never sorted explicitly; the PostgreSQL version keeps this order)
async function listByOriginTime(startTime, endTime) {
  const docs = await EQEvents.find({ OT: { $gte: startTime, $lte: endTime } });
  return docs.map(toEvent);
}

// Resolves to null when no event has this publicID
async function findByPublicID(publicID) {
  return toEvent(await EQEvents.findOne({ publicID }));
}

// For comments, which refer to an event by its MongoDB id: { _id, publicID }, or null
async function findRefById(id) {
  if (!isObjectId(id)) return null;
  return EQEvents.findById(id).select('_id publicID').lean();
}

// --- SeisComP ingest ---

// What ingest compares a new message with, or null if SeisComP hasn't sent this event before
async function findIngestState(publicID) {
  return EQEvents.findOne(
    { publicID },
    {
      depth_value: 1,
      latitude_value: 1,
      longitude_value: 1,
      place: 1,
      last_modification: 1,
      recordingStations: 1,
      recordingAvailabilityStatus: 1,
    },
  ).lean();
}

/***************************************************************************
  * saveFromSeiscomp:
  *     Saves an event SeisComP sent: inserts it, or updates the stored one, unless the stored one has a
  *     newer last_modification (an update that arrived out of order, which is dropped).
  *
  * Inputs:
  *     publicID
  *     fields      OT, latitude_value, longitude_value, depth_value, magnitude_value, type, text,
  *                 sourceCatalog, sourceServer, sourceSeiscompVersion, last_modification, and the
  *                 station lists and status ingest computed: candidateStations, onlineStations,
  *                 recordingAvailabilityStatus. `location` follows latitude/longitude, and is removed
  *                 when they're invalid.
  *     options.clearPlace       remove the stored place name (the event moved; it's recomputed on read)
  *     options.catalogSources   for a new event: the catalogs to look it up in (all start pending)
  *
  * Returns:
  *     true when saved, false when dropped as out of order
  ***************************************************************************/
async function saveFromSeiscomp(publicID, fields, { clearPlace = false, catalogSources = [] } = {}) {
  const incoming = fields.last_modification ? new Date(fields.last_modification) : null;
  const filter = incoming && Number.isFinite(incoming.getTime())
    ? { publicID, $or: [{ last_modification: null }, { last_modification: { $lte: incoming } }] }
    : { publicID };

  // An event SeisComP sends is current, so it's no longer a legacy import
  const update = {
    $set: { ...fields, isLegacyRecord: false, legacyImportedAt: null, legacySourcePublicID: null },
    $setOnInsert: {
      publicID,
      recordingStations: [],
      recordingAvailabilityAttempts: 0,
      pendingCatalogSources: catalogSources,
      catalogEnrichmentAttempts: {},
      catalogEnrichmentStatus: Object.fromEntries(catalogSources.map((source) => [source, 'pending'])),
    },
  };
  const unset = {};
  if (clearPlace) unset.place = '';
  // Out-of-range coordinates would make the 2dsphere index reject the whole write, so the point is
  // dropped instead of stored
  const location = toGeoPoint(fields.latitude_value, fields.longitude_value);
  if (location) {
    update.$set.location = location;
  } else {
    unset.location = '';
  }
  if (Object.keys(unset).length > 0) update.$unset = unset;

  // When the filter misses an event that exists, the upsert's insert hits the unique publicID index:
  // either the stored copy is newer (dropped), or another message inserted it a moment ago (try again)
  for (let attempt = 1; ; attempt += 1) {
    try {
      await EQEvents.updateOne(filter, update, { upsert: true });
      return true;
    } catch (err) {
      if (err?.code !== 11000) throw err;
      if (attempt === 2) return false;
    }
  }
}

// --- Place names ---

// Values that mean "no place name yet": a computed one may replace them
const PLACES_TO_REPLACE = [null, '', 'Unavailable', 'Unable to geocode', 'Nominatim unavailable'];

// Saves the place name computed on first read, unless the event already has one.
// `event`: anything with its `_id` or `publicID`
async function savePlace(event, place) {
  let identity = null;
  if (event?._id) identity = { _id: event._id };
  else if (event?.publicID) identity = { publicID: event.publicID };
  if (!identity) return;

  await EQEvents.updateOne({ ...identity, place: { $in: PLACES_TO_REPLACE } }, { $set: { place } });
}

// --- Summary override ---

// Both resolve to the updated event, or null when no event has this publicID. An event without an
// override shows summaryOverride: null (the model's default).
async function setSummary(publicID, text, editedBy) {
  const doc = await EQEvents.findOneAndUpdate(
    { publicID },
    { $set: { summaryOverride: { text, editedAt: new Date(), ...(editedBy ? { editedBy } : {}) } } },
    { new: true, runValidators: true },
  );
  return toEvent(doc);
}

async function clearSummary(publicID) {
  return toEvent(await EQEvents.findOneAndUpdate({ publicID }, { $unset: { summaryOverride: '' } }, { new: true }));
}

// --- Station check (which nearby stations recorded each event) ---

const STATION_CHECK_FIELDS = {
  OT: 1,
  latitude_value: 1,
  longitude_value: 1,
  candidateStations: 1,
  onlineStations: 1,
  recordingAvailabilityAttempts: 1,
  recordingAvailabilityStatus: 1,
};

const STATION_CHECK_RESULTS = [
  'candidateStations',
  'recordingStations',
  'recordingAvailabilityStatus',
  'recordingAvailabilityCheckedAt',
  'recordingAvailabilityAttempts',
  'onlineStations',
];

// One event with the fields the check reads ({ _id, OT, latitude_value, ... }), or null
async function findForStationCheck(publicID) {
  return EQEvents.findOne({ publicID }, STATION_CHECK_FIELDS).lean();
}

// Events with coordinates, `limit` at a time in a fixed order: pass the last one's _id as `after`
// to get the next batch
async function listForStationCheck({ after = null, limit }) {
  const withCoordinates = { latitude_value: { $ne: null }, longitude_value: { $ne: null } };
  return EQEvents.find(after ? { ...withCoordinates, _id: { $gt: after } } : withCoordinates, STATION_CHECK_FIELDS)
    .sort({ _id: 1 })
    .limit(limit)
    .lean();
}

// Saves check results, [{ _id, ...any of STATION_CHECK_RESULTS }], each event's fields together.
// Resolves to { matchedCount, modifiedCount } (shown in the API): every save also sets updatedAt, so
// each event found counts as modified, even when its results didn't change.
async function saveStationChecks(results) {
  if (results.length === 0) return { matchedCount: 0, modifiedCount: 0 };
  const { matchedCount, modifiedCount } = await EQEvents.bulkWrite(results.map(({ _id, ...fields }) => ({
    updateOne: {
      filter: { _id },
      update: { $set: Object.fromEntries(STATION_CHECK_RESULTS.filter((key) => key in fields).map((key) => [key, fields[key]])) },
    },
  })));
  return { matchedCount, modifiedCount };
}

// The onlineStations of the first stored event (shown in the check's summary), or null when there's none
async function sampleOnlineStations() {
  const doc = await EQEvents.findOne({}, { onlineStations: 1 }).lean();
  return doc ? doc.onlineStations : null;
}

// --- Catalog enrichment (PHIVOLCS / USGS matches) ---

// Origin time at or before `cutoff`, with a catalog still pending; or, for records from before
// per-catalog tracking, the legacy upForEnrichment flag with attempts left
const enrichmentEligible = ({ cutoff, maxAttempts }) => ({
  OT: { $lte: cutoff },
  $or: [
    { pendingCatalogSources: { $exists: true, $ne: [] } },
    { upForEnrichment: true, enrichmentAttempts: { $lt: maxAttempts } },
  ],
});

async function countEnrichmentEligible({ cutoff, maxAttempts }) {
  return EQEvents.countDocuments(enrichmentEligible({ cutoff, maxAttempts }));
}

// The oldest `limit` eligible events (by origin time), with their stored enrichment state
async function listEnrichmentEligible({ cutoff, maxAttempts, limit }) {
  return EQEvents.find(enrichmentEligible({ cutoff, maxAttempts })).sort({ OT: 1 }).limit(limit).lean();
}

/***************************************************************************
  * saveEnrichment:
  *     Saves one enrichment pass over an event, all in one write: its catalog matches
  *     (additionalInformation, at most one per catalog), the catalogs still pending, and each
  *     catalog's attempts and status ({ phivolcs: 'done', usgs: 'pending' }).
  ***************************************************************************/
async function saveEnrichment(id, { additionalInformation, pendingCatalogSources, catalogEnrichmentAttempts, catalogEnrichmentStatus }) {
  await EQEvents.updateOne(
    { _id: id },
    {
      $set: {
        additionalInformation,
        pendingCatalogSources,
        catalogEnrichmentAttempts,
        catalogEnrichmentStatus,
        upForEnrichment: pendingCatalogSources.length > 0, // legacy flag, kept in step
      },
      $inc: { enrichmentAttempts: 1 },
    },
  );
}

module.exports = {
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
