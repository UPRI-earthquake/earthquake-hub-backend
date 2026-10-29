// How earthquake events map between the shape the API sends (MongoDB's field names) and the PostgreSQL
// tables. Shared by postgres/events.repo.js and scripts/copy-earthquakes-to-postgres.js, so the copy
// stores exactly what the repository reads back.

// --- Station lists ---

// Upper-cased, trimmed, without blanks or repeats: how the app treats station lists
const normalizeStations = (list) => {
  const seen = new Set();
  return (Array.isArray(list) ? list : [])
    .map((station) => String(station ?? '').trim().toUpperCase())
    .filter((station) => station && !seen.has(station) && seen.add(station));
};

// onlineStations, worked out from the candidate and recording lists: the same rule as
// resolveRecordingDisplayStations in src/services/EQevents.service.js, which MongoDB stored the
// result of
const displayStations = (status, candidates, recording, withinGracePeriod) => {
  if (status === 'pending') return candidates;
  if (status === 'partial' && withinGracePeriod) return normalizeStations([...recording, ...candidates]);
  if (status === 'partial' || status === 'verified') return recording;
  return [];
};

// --- Catalog matches (additionalInformation[] entries) ---

const toDate = (value) => {
  if (value === null || value === undefined) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
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
const MATCH_QUALITIES = new Set(['high', 'medium', 'low']);

const asType = (value, type) => {
  if (value === null) return null;
  if (type === 'text') return typeof value === 'string' ? value : undefined;
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  if (type === 'boolean') return typeof value === 'boolean' ? value : undefined;
  const date = value instanceof Date || typeof value === 'string' ? toDate(value) : null; // 'date'
  return date || undefined;
};

// A catalog entry as event_catalog_matches columns (without event_id and timestamps). jsonb values are
// JSON text, since knex would send a JS array as a PostgreSQL array.
const toMatchColumns = (entry, source) => {
  const row = { source };
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

// An event_catalog_matches row back as the catalog entry the API shows (empty columns left out)
const toCatalogEntry = (row) => {
  const entry = { ...(row.extra || {}), source: row.source };
  const put = (key, value) => {
    if (value !== null && value !== undefined) entry[key] = value;
  };
  Object.entries(MATCH_FIELDS).forEach(([key, [column]]) => {
    if (column !== 'depth_km') put(key, row[column]);
  });
  put(row.source === 'usgs' ? 'depth' : 'depthKm', row.depth_km);
  put('matchQuality', row.match_quality);
  put('raw', row.raw);
  return entry;
};

module.exports = {
  normalizeStations,
  displayStations,
  toMatchColumns,
  toCatalogEntry,
};
