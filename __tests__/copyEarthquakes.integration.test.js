const mongoose = require('mongoose');
const { copyEarthquakes } = require('../scripts/copy-earthquakes-to-postgres');
const { startMongo, MONGO_STARTUP_TIMEOUT_MS } = require('./fixtures/mongo.fixture');
const { startPostgres, PG_STARTUP_TIMEOUT_MS } = require('./fixtures/postgres.fixture');

const oid = (hex) => new mongoose.Types.ObjectId(hex);
const at = (iso) => new Date(iso);

const ID = {
  quezon: oid('6b0000000000000000000e01'),
  davao: oid('6b0000000000000000000e02'),
  legacy: oid('6b0000000000000000000e03'),
  other: oid('6b0000000000000000000e04'),
};

const PHIVOLCS_MATCH = {
  source: 'phivolcs',
  sourceLabel: 'PHIVOLCS',
  sourceIconUrl: 'https://earthquake.phivolcs.dost.gov.ph/favicon.ico',
  dateTime: '01 May 2026 - 04:00 PM',
  detailUrl: 'https://earthquake.phivolcs.dost.gov.ph/2026_Earthquake_Information/May/2026_0501_0800_B1.html',
  hasFeltIntensity: true,
  time: at('2026-05-01T08:00:00.000Z'),
  latitude: 14.68,
  longitude: 121.05,
  depthKm: 10,
  magnitude: 4.4,
  location: '010 km N 45° E of Quezon City (Metro Manila)',
  distanceKm: 1.5,
  timeDifferenceMinutes: 0,
  magnitudeDifference: 0.1,
  score: 0.55,
  matchQuality: 'high',
};
const USGS_MATCH = {
  source: 'usgs',
  sourceLabel: 'USGS',
  id: 'us7000golden',
  title: 'M 4.6 - 10 km NNE of Quezon City, Philippines',
  place: '10 km NNE of Quezon City, Philippines',
  url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000golden',
  queryUrl: 'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson',
  time: at('2026-05-01T08:00:05.000Z'),
  latitude: 14.66,
  longitude: 121.06,
  depth: 12,
  magnitude: 4.6,
  latitudeFloorMatch: true,
  longitudeFloorMatch: true,
  score: -7.2,
  matchQuality: 'medium',
  network: 'us', // a key without a column
};

// An event as the app stores it today
const event = (fields) => ({
  publicID: 'upri2026jabc',
  OT: at('2026-05-01T08:00:00.000Z'),
  latitude_value: 14.67,
  longitude_value: 121.06,
  depth_value: 10,
  magnitude_value: 4.5,
  type: 'UPDATE',
  text: 'Luzon, Philippines',
  place: '3 km N of Quezon City, Metro Manila, Philippines',
  sourceCatalog: 'upri-current',
  sourceServer: 'earthquake.up.edu.ph',
  isLegacyRecord: false,
  candidateStations: ['R3B2D', 'RE722'],
  recordingStations: ['R3B2D'],
  onlineStations: ['R3B2D'],
  recordingAvailabilityStatus: 'partial',
  recordingAvailabilityAttempts: 2,
  recordingAvailabilityCheckedAt: at('2026-05-01T08:35:00.000Z'),
  last_modification: at('2026-05-01T08:05:00.000Z'),
  additionalInformation: [PHIVOLCS_MATCH, USGS_MATCH],
  pendingCatalogSources: [],
  catalogEnrichmentAttempts: { phivolcs: 1, usgs: 1 },
  catalogEnrichmentStatus: { phivolcs: 'done', usgs: 'done' },
  upForEnrichment: false,
  enrichmentAttempts: 1,
  summaryOverride: { text: 'Felt in Quezon City.', editedAt: at('2026-05-02T00:00:00.000Z'), editedBy: 'juan' },
  createdAt: at('2026-05-01T08:01:00.000Z'),
  updatedAt: at('2026-05-02T00:00:00.000Z'),
  ...fields,
});

describe('scripts/copy-earthquakes-to-postgres', () => {
  let mongo;
  let pg;
  let lines;
  let device;
  const events = () => mongoose.connection.collection('events');
  const copy = (options = {}) => copyEarthquakes({ db: pg.db, log: (line) => lines.push(line), ...options });
  const pgEvent = (legacyId) => pg.db('events').where({ legacy_mongo_id: String(legacyId) }).first();
  const pgCount = async (table) => Number((await pg.db(table).count({ n: '*' }).first()).n);
  const stationsOf = async (legacyId) => pg.db('event_stations AS s')
    .join('events AS e', 'e.id', 's.event_id').join('devices AS d', 'd.id', 's.device_id')
    .where('e.legacy_mongo_id', String(legacyId)).orderBy(['s.kind', 's.position'])
    .select('s.kind', 's.position', 'd.station');
  const statusOf = async (legacyId) => pg.db('event_catalog_status AS c').join('events AS e', 'e.id', 'c.event_id')
    .where('e.legacy_mongo_id', String(legacyId)).orderBy('c.source').select('c.source', 'c.status', 'c.attempts');
  const matchesOf = async (legacyId) => pg.db('event_catalog_matches AS m').join('events AS e', 'e.id', 'm.event_id')
    .where('e.legacy_mongo_id', String(legacyId)).orderBy('m.source').select('m.*');
  const location = async (legacyId) => {
    const { rows: [point] } = await pg.db.raw(
      'SELECT ST_X(location::geometry) AS lon, ST_Y(location::geometry) AS lat FROM events WHERE legacy_mongo_id = ?', [String(legacyId)],
    );
    return point.lon === null ? null : [point.lon, point.lat];
  };

  beforeAll(async () => {
    [mongo, pg] = await Promise.all([startMongo(), startPostgres()]);
  }, Math.max(MONGO_STARTUP_TIMEOUT_MS, PG_STARTUP_TIMEOUT_MS));

  // The devices step 2 of the migration copied
  beforeEach(async () => {
    lines = [];
    device = {};
    for (const [station, network] of [['R3B2D', 'AM'], ['RE722', 'AM'], ['R0001', 'AM']]) {
      [device[station]] = await pg.db('devices').insert({ network, station, latitude: 14.6, longitude: 121, elevation_m: 50 }).returning('*');
    }
  });

  afterEach(() => Promise.all([mongo.clear(), pg.clear()]));

  afterAll(async () => {
    await Promise.all([mongo && mongo.stop(), pg && pg.stop()]);
  });

  test('copies an event with its stations, catalog matches and enrichment status', async () => {
    await events().insertOne(event({ _id: ID.quezon }));

    const result = await copy();

    expect(result.ok).toBe(true);
    expect(await pgEvent(ID.quezon)).toMatchObject({
      public_id: 'upri2026jabc',
      origin_time: at('2026-05-01T08:00:00.000Z'),
      latitude: 14.67,
      longitude: 121.06,
      depth_km: 10,
      magnitude: 4.5,
      seiscomp_type: 'UPDATE',
      region_text: 'Luzon, Philippines',
      place: '3 km N of Quezon City, Metro Manila, Philippines',
      recording_status: 'partial',
      recording_attempts: 2,
      recording_checked_at: at('2026-05-01T08:35:00.000Z'),
      last_modification: at('2026-05-01T08:05:00.000Z'),
      summary_override_text: 'Felt in Quezon City.',
      summary_override_edited_by: 'juan',
      is_legacy_record: false,
      created_at: at('2026-05-01T08:01:00.000Z'),
      updated_at: at('2026-05-02T00:00:00.000Z'),
    });
    expect(await location(ID.quezon)).toEqual([121.06, 14.67]);
    expect(await stationsOf(ID.quezon)).toEqual([
      { kind: 'candidate', position: 0, station: 'R3B2D' },
      { kind: 'candidate', position: 1, station: 'RE722' },
      { kind: 'recording', position: 0, station: 'R3B2D' },
    ]);
    expect(await statusOf(ID.quezon)).toEqual([
      { source: 'phivolcs', status: 'done', attempts: 1 },
      { source: 'usgs', status: 'done', attempts: 1 },
    ]);

    const [phivolcs, usgs] = await matchesOf(ID.quezon);
    expect(phivolcs).toMatchObject({
      source: 'phivolcs', source_label: 'PHIVOLCS', match_time_text: '01 May 2026 - 04:00 PM', match_time: at('2026-05-01T08:00:00.000Z'),
      depth_km: 10, has_felt_intensity: true, location_text: '010 km N 45° E of Quezon City (Metro Manila)', score: 0.55, match_quality: 'high', extra: {}, raw: null,
    });
    expect(usgs).toMatchObject({
      source: 'usgs', external_id: 'us7000golden', depth_km: 12, latitude_floor_match: true, match_quality: 'medium', extra: { network: 'us' },
    });
    expect(result.stations).toMatchObject({ mongoTotal: 3, written: 3, unmatched: [], onlineStationsDiffer: [] });
    expect(result.matches).toMatchObject({ mongoTotal: 2, written: 2, unknownSource: [] });
  });

  test('reports station codes that match no device, or several, and leaves them out', async () => {
    await pg.db('devices').insert({ network: 'XX', station: 'R0001', latitude: 7, longitude: 125, elevation_m: 10 });
    await events().insertOne(event({ _id: ID.quezon, candidateStations: ['R3B2D', 'RGONE', 'R0001'], recordingStations: [], recordingAvailabilityStatus: 'pending', onlineStations: ['R3B2D'] }));

    const result = await copy();

    expect(result.ok).toBe(true);
    expect(result.stations.unmatched).toEqual([{ id: `${ID.quezon} (upri2026jabc)`, station: 'RGONE', kind: 'candidate' }]);
    expect(result.stations.ambiguous).toEqual([{ id: `${ID.quezon} (upri2026jabc)`, station: 'R0001', kind: 'candidate' }]);
    expect(await stationsOf(ID.quezon)).toEqual([{ kind: 'candidate', position: 0, station: 'R3B2D' }]);
    expect(lines.join('\n')).toMatch(/no device with that station: 1\n.*RGONE \(candidate\)/);
  });

  test('older records without candidateStations use onlineStations; a stored list that would show differently is reported', async () => {
    await events().insertOne(event({
      _id: ID.legacy, candidateStations: [], recordingStations: [], onlineStations: ['re722', 'R3B2D', 'R3B2D'], recordingAvailabilityStatus: 'pending',
    }));
    await events().insertOne(event({
      _id: ID.other, publicID: 'upri2026jxyz', candidateStations: ['R3B2D', 'RE722'], onlineStations: ['RE722', 'R3B2D'], recordingStations: [], recordingAvailabilityStatus: 'pending',
    }));

    const result = await copy();

    expect(await stationsOf(ID.legacy)).toEqual([
      { kind: 'candidate', position: 0, station: 'RE722' },
      { kind: 'candidate', position: 1, station: 'R3B2D' },
    ]);
    expect(result.stations.fromOnlineStations).toEqual([`${ID.legacy} (upri2026jabc)`]);
    expect(result.stations.onlineStationsDiffer).toEqual([
      { id: `${ID.other} (upri2026jxyz)`, stored: ['RE722', 'R3B2D'], shown: ['R3B2D', 'RE722'] },
    ]);
  });

  test('copies events with missing or out-of-range coordinates with no location, and reports them', async () => {
    await events().insertOne(event({ _id: ID.quezon, latitude_value: 95 }));
    await events().insertOne(event({ _id: ID.davao, publicID: 'upri2026jdef', latitude_value: null, longitude_value: null }));

    const result = await copy();

    expect(result.ok).toBe(true);
    expect(result.events.noLocation).toEqual([`${ID.quezon} (upri2026jabc)`, `${ID.davao} (upri2026jdef)`]);
    expect(await location(ID.quezon)).toBeNull();
    expect((await pgEvent(ID.quezon)).latitude).toBe(95);
    expect(await location(ID.davao)).toBeNull();
  });

  test('skips events whose publicID another MongoDB event or a PostgreSQL event has, and events that cannot be stored', async () => {
    // (no unique publicID index here: the Event model isn't loaded, as in a MongoDB that never had it)
    await events().insertMany([
      event({ _id: ID.quezon }),
      event({ _id: ID.davao }), // same publicID
      event({ _id: ID.legacy, publicID: 'upri2026jpg' }),
      event({ _id: ID.other, publicID: 'upri2026jlong', type: 'AUTOMATIC-UPDATE' }),
    ]);
    await pg.db('events').insert({ public_id: 'upri2026jpg' }); // e.g. sent by SeisComP after the switch

    const result = await copy();

    expect(result.ok).toBe(true);
    expect(result.events.skipped).toEqual([
      { id: `${ID.other} (upri2026jlong)`, reason: 'type "AUTOMATIC-UPDATE" longer than 10 characters' },
      { id: `${ID.quezon} (upri2026jabc)`, reason: `same publicID as ${ID.davao}` },
      { id: `${ID.davao} (upri2026jabc)`, reason: `same publicID as ${ID.quezon}` },
      { id: `${ID.legacy} (upri2026jpg)`, reason: 'publicID already used by another PostgreSQL event' },
    ]);
    expect(await pgCount('events')).toBe(1);
  });

  test('matches: unknown catalogs are reported and left out, legacy UPRI entries kept, a catalog listed twice keeps its last entry', async () => {
    const legacyEntry = { source: 'upri-legacy', sourceLabel: 'UPRI (legacy)', id: 'old-1', title: 'Old catalog entry', depthKm: 8, sourceServer: 'old.example.org', raw: { magnitude: '4.3', tags: ['a'] } };
    await events().insertOne(event({
      _id: ID.legacy,
      additionalInformation: [PHIVOLCS_MATCH, { source: 'emsc', title: 'EMSC' }, legacyEntry, { ...PHIVOLCS_MATCH, magnitude: 4.3 }],
    }));

    const result = await copy();

    expect(result.ok).toBe(true);
    expect(result.matches.unknownSource).toEqual([{ id: `${ID.legacy} (upri2026jabc)`, source: 'emsc' }]);
    expect(result.matches.duplicates).toEqual([{ id: `${ID.legacy} (upri2026jabc)`, source: 'phivolcs' }]);
    const [phivolcs, legacy] = await matchesOf(ID.legacy);
    expect(phivolcs.magnitude).toBe(4.3);
    expect(legacy).toMatchObject({
      source: 'upri-legacy', external_id: 'old-1', depth_km: 8, extra: { sourceServer: 'old.example.org' }, raw: { magnitude: '4.3', tags: ['a'] },
    });
  });

  test("keeps MongoDB's match order, null values, and an empty place", async () => {
    await events().insertOne(event({ _id: ID.quezon, place: '', additionalInformation: [USGS_MATCH, { ...PHIVOLCS_MATCH, depthKm: null }] }));

    await copy();

    const [usgs, phivolcs] = await pg.db('event_catalog_matches').orderBy('position').select('source', 'depth_km', 'extra');
    expect([usgs.source, phivolcs.source]).toEqual(['usgs', 'phivolcs']);
    expect(phivolcs).toMatchObject({ depth_km: null, extra: { depthKm: null } });
    expect((await pgEvent(ID.quezon)).place).toBe('');
  });

  test.each([
    ['a catalog still pending', { pendingCatalogSources: ['usgs'], catalogEnrichmentStatus: { phivolcs: 'no_match', usgs: 'pending' }, catalogEnrichmentAttempts: { phivolcs: 1, usgs: 1 } },
      [['phivolcs', 'no_match', 1], ['usgs', 'pending', 1]]],
    ['statuses without attempts: attempts from the legacy counter', { catalogEnrichmentAttempts: {}, enrichmentAttempts: 1, catalogEnrichmentStatus: { phivolcs: 'no_match', usgs: 'done' } },
      [['phivolcs', 'no_match', 1], ['usgs', 'done', 1]]],
    ['legacy: finished, with a USGS match only', { catalogEnrichmentStatus: undefined, catalogEnrichmentAttempts: undefined, pendingCatalogSources: undefined, upForEnrichment: false, enrichmentAttempts: 1, additionalInformation: [USGS_MATCH] },
      [['phivolcs', 'no_match', 1], ['usgs', 'done', 1]]],
    ['legacy: attempts ran out', { catalogEnrichmentStatus: undefined, catalogEnrichmentAttempts: undefined, pendingCatalogSources: undefined, upForEnrichment: true, enrichmentAttempts: 3, additionalInformation: [] },
      [['phivolcs', 'failed', 3], ['usgs', 'failed', 3]]],
    ['no tracking at all: pending, so the nightly job finds it', { catalogEnrichmentStatus: undefined, catalogEnrichmentAttempts: undefined, pendingCatalogSources: undefined, upForEnrichment: undefined, enrichmentAttempts: undefined, additionalInformation: [] },
      [['phivolcs', 'pending', 0], ['usgs', 'pending', 0]]],
  ])('enrichment status: %s', async (label, fields, expected) => {
    const doc = event({ _id: ID.quezon, ...fields });
    Object.keys(doc).forEach((key) => doc[key] === undefined && delete doc[key]);
    await events().insertOne(doc);

    const result = await copy();

    expect(result.ok).toBe(true);
    expect(await statusOf(ID.quezon)).toEqual(expected.map(([source, status, attempts]) => ({ source, status, attempts })));
  });

  test('reports unknown status values and works the status out from the other fields', async () => {
    await events().insertOne(event({ _id: ID.quezon, catalogEnrichmentStatus: { phivolcs: 'weird', usgs: 'done' } }));

    const result = await copy();

    expect(result.status.unknownStatuses).toEqual([{ id: `${ID.quezon} (upri2026jabc)`, values: ['phivolcs: "weird"'] }]);
    expect((await statusOf(ID.quezon))[0]).toEqual({ source: 'phivolcs', status: 'done', attempts: 1 });
  });

  test('re-running is safe: no duplicates; MongoDB changes rewrite the event and its rows; PostgreSQL changes are kept with them', async () => {
    await events().insertMany([event({ _id: ID.quezon }), event({ _id: ID.davao, publicID: 'upri2026jdef' })]);
    await copy();

    const unchanged = await copy();
    expect(unchanged.ok).toBe(true);
    expect(unchanged.events).toMatchObject({ inserted: 0, updated: 2, keptNewer: 0 });
    expect([await pgCount('event_stations'), await pgCount('event_catalog_matches'), await pgCount('event_catalog_status')]).toEqual([6, 4, 4]);

    // MongoDB changes one event; PostgreSQL changes the other (and its rows) after the copy
    await events().updateOne({ _id: ID.quezon }, { $set: { recordingStations: ['R3B2D', 'RE722'], recordingAvailabilityStatus: 'verified', updatedAt: at('2026-05-03T00:00:00.000Z') } });
    const davao = await pgEvent(ID.davao);
    await pg.db('events').where({ id: davao.id }).update({ magnitude: 4.9 }); // updated_at becomes now()
    await pg.db('event_catalog_status').where({ event_id: davao.id, source: 'usgs' }).update({ status: 'failed' });
    await events().updateOne({ _id: ID.davao }, { $set: { magnitude_value: 3.0, recordingStations: [] } });

    const result = await copy();

    expect(result.ok).toBe(true);
    expect(result.events).toMatchObject({ inserted: 0, updated: 1, keptNewer: 1 });
    expect(await stationsOf(ID.quezon)).toEqual([
      { kind: 'candidate', position: 0, station: 'R3B2D' },
      { kind: 'candidate', position: 1, station: 'RE722' },
      { kind: 'recording', position: 0, station: 'R3B2D' },
      { kind: 'recording', position: 1, station: 'RE722' },
    ]);
    expect((await pgEvent(ID.quezon)).recording_status).toBe('verified');
    expect((await pgEvent(ID.davao)).magnitude).toBe(4.9);
    expect((await stationsOf(ID.davao)).filter((s) => s.kind === 'recording')).toHaveLength(1);
    expect((await statusOf(ID.davao))[1]).toMatchObject({ source: 'usgs', status: 'failed' });
    expect(lines.join('\n')).toMatch(/kept with their rows \(changed in PostgreSQL since copied\): 1/);
  });

  test('a dry run writes nothing', async () => {
    await events().insertOne(event({ _id: ID.quezon }));

    const result = await copy({ dryRun: true });

    expect(result.events).toMatchObject({ inserted: 1, updated: 0 });
    expect(result.stations.written).toBe(3);
    expect([await pgCount('events'), await pgCount('event_stations'), await pgCount('event_catalog_matches'), await pgCount('event_catalog_status')]).toEqual([0, 0, 0, 0]);
    expect(lines[0]).toMatch(/^\[dry run\] Events in MongoDB: 1/);
  });
});
