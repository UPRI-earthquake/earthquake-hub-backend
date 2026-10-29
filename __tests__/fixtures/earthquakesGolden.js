// Golden-file tests for Earthquakes (events) of the PostgreSQL migration. They run the real app against
// seeded data, with the external services faked (fixtures/earthquakesExternal.js), and compare each
// response with its recording in __tests__/golden/. Each earthquakes.golden.*.integration.test.js runs
// these cases with one set of area settings, so every setting must give identical responses.
//
// Two jobs aren't endpoints: the station check of one new event (run by a timer after ingest) is
// called directly and its result recorded the same way.
//
// The test file must mock axios and puppeteer-core with the fakes (see earthquakesExternal.js).
const request = require('supertest');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { startMongo, MONGO_STARTUP_TIMEOUT_MS } = require('./mongo.fixture');
const { startPostgres, PG_STARTUP_TIMEOUT_MS } = require('./postgres.fixture');
const { expectGolden } = require('./golden');
const External = require('./earthquakesExternal');

const oid = (hex) => new mongoose.Types.ObjectId(hex);
const at = (iso) => new Date(iso);

const PASSWORD = 'Golden-Password-2026!';
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 10);
const SEEDED_AT = at('2026-05-10T00:00:00.000Z');

// Settings that change what the jobs do, fixed so the recordings don't depend on a developer's .env.
// The station check of a new event is pushed out of the test run (it's called directly instead).
const JOB_ENV = {
  ...External.ENV,
  ONLINE_STATION_REFINEMENT_DELAY_MS: String(60 * 60 * 1000),
  ONLINE_STATIONS_BATCH_SIZE: '2', // pages through the events in batches of 2
  RECORDING_AVAILABILITY_GRACE_PERIOD_MS: String(30 * 60 * 1000),
  RECORDING_AVAILABILITY_MAX_ATTEMPTS: '4',
  MAX_ENRICHMENT_ATTEMPTS: '3',
  ENRICHMENT_MIN_AGE_HOURS: '12',
  ENRICHMENT_BATCH_SIZE: '25',
  EVENT_SOURCE_CATALOG: 'upri-current',
  EVENT_SOURCE_SERVER: 'earthquake.up.edu.ph',
  EVENT_SOURCE_SEISCOMP_VERSION: '',
};

// --- Seeded data ---

const DEVICES = [
  ['R3B2D', 'active', 14.65, 121.07],
  ['RE722', 'active', 16.4, 120.6],
  ['R0001', 'inactive', 7.07, 125.6],
].map(([station, activity, latitude, longitude], i) => ({
  _id: oid(`69000000000000000000d10${i}`),
  description: `golden device ${station}`,
  network: 'AM',
  station,
  streamId: `AM_${station}_.*/MSEED`,
  macAddress: `B8:27:EB:00:10:0${i}`,
  latitude,
  longitude,
  elevation: 50,
  location: { type: 'Point', coordinates: [longitude, latitude] },
  activity,
  activityToggleTime: at('2026-04-01T00:00:00.000Z'),
  rshakeAlertCredentialHash: null,
  rshakeAlertCredentialIssuedAt: null,
  createdAt: at('2025-01-01T00:00:00.000Z'),
  updatedAt: at('2025-01-01T00:00:00.000Z'),
  __v: 0,
}));

const account = (fields) => ({
  passwordPolicyVersion: 2,
  passwordUpdatedAt: at('2025-02-01T00:00:00.000Z'),
  isApproved: false,
  devices: [],
  releasedDevices: [],
  alertPreferences: { rshakeEmailEnabled: false },
  createdAt: at('2025-01-01T00:00:00.000Z'),
  updatedAt: at('2025-01-01T00:00:00.000Z'),
  __v: 0,
  password: PASSWORD_HASH,
  ...fields,
});

const ACCOUNTS = [
  account({ _id: oid('69000000000000000000a101'), username: 'golden_citizen', email: 'golden.citizen@example.org', roles: ['citizen', 'sensor'] }),
  account({
    _id: oid('69000000000000000000a102'),
    username: 'golden_brgy',
    email: 'golden.brgy@example.org',
    roles: ['brgy'],
    isApproved: true,
    ringserverUrl: 'ringserver.golden.example.org',
    ringserverPort: 18000,
  }),
];
// Admins have no sign-in endpoint: their session token is minted directly (see adminCookie)
const ADMIN = { accountId: '69000000000000000000a1ad', username: 'golden_admin', role: 'admin' };

// An event as the app stores it today, every field set
const event = (fields) => {
  const stored = {
    sourceCatalog: 'upri-current',
    sourceServer: 'earthquake.up.edu.ph',
    isLegacyRecord: false,
    depth_value: 10,
    type: 'NEW',
    text: 'Luzon, Philippines',
    onlineStations: [],
    candidateStations: [],
    recordingStations: [],
    recordingAvailabilityStatus: 'pending',
    recordingAvailabilityAttempts: 0,
    upForEnrichment: true,
    enrichmentAttempts: 0,
    additionalInformation: [],
    pendingCatalogSources: ['phivolcs', 'usgs'],
    catalogEnrichmentAttempts: {},
    catalogEnrichmentStatus: { phivolcs: 'pending', usgs: 'pending' },
    summaryOverride: null,
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
    __v: 0,
    ...fields,
  };
  if (Number.isFinite(stored.latitude_value) && Number.isFinite(stored.longitude_value)) {
    stored.location = { type: 'Point', coordinates: [stored.longitude_value, stored.latitude_value] };
  }
  return stored;
};

const EVENTS = [
  // Near Quezon City, with a place name; both catalogs pending, and both will match
  event({
    _id: oid('69000000000000000000e101'),
    publicID: 'upri2026jabc',
    OT: at('2026-05-01T08:00:00.000Z'),
    latitude_value: 14.67,
    longitude_value: 121.06,
    magnitude_value: 4.5,
    place: '3 km N of Quezon City, Metro Manila, Philippines',
    onlineStations: ['R3B2D', 'RE722'],
    candidateStations: ['R3B2D', 'RE722'],
    last_modification: at('2026-05-01T08:05:00.000Z'),
  }),
  // Near Davao, no place name yet, an edited summary; PHIVOLCS already matched, USGS pending
  event({
    _id: oid('69000000000000000000e102'),
    publicID: 'upri2026jdef',
    OT: at('2026-05-03T02:00:00.000Z'),
    latitude_value: 7.1,
    longitude_value: 125.5,
    depth_value: 30,
    magnitude_value: 3.2,
    text: 'Mindanao, Philippines',
    onlineStations: ['R0001'],
    candidateStations: ['R0001'],
    recordingStations: ['R0001'],
    recordingAvailabilityStatus: 'verified',
    recordingAvailabilityAttempts: 1,
    recordingAvailabilityCheckedAt: at('2026-05-03T02:35:00.000Z'),
    last_modification: at('2026-05-03T02:04:00.000Z'),
    summaryOverride: { text: 'Weak shaking was felt in Davao City.', editedAt: at('2026-05-03T05:00:00.000Z'), editedBy: 'golden_citizen' },
    additionalInformation: [{
      source: 'phivolcs',
      sourceLabel: 'PHIVOLCS',
      sourceIconUrl: 'https://earthquake.phivolcs.dost.gov.ph/favicon.ico',
      dateTime: '03 May 2026 - 10:00 AM',
      detailUrl: 'https://earthquake.phivolcs.dost.gov.ph/2026_Earthquake_Information/May/2026_0503_0200_B1.html',
      hasFeltIntensity: false,
      time: '2026-05-03T02:00:00.000Z',
      latitude: 7.12,
      longitude: 125.52,
      depthKm: 28,
      magnitude: 3.3,
      location: '005 km N 10° E of Davao City (Davao Del Sur)',
      distanceKm: 3.11,
      timeDifferenceMinutes: 0,
      magnitudeDifference: 0.1,
      score: 1.87,
      matchQuality: 'high',
    }],
    pendingCatalogSources: ['usgs'],
    catalogEnrichmentAttempts: { phivolcs: 1, usgs: 1 },
    catalogEnrichmentStatus: { phivolcs: 'done', usgs: 'pending' },
    enrichmentAttempts: 1,
  }),
  // A legacy import from before most fields existed (no magnitude): only what the import wrote
  {
    _id: oid('69000000000000000000e103'),
    publicID: 'upri2026jghi',
    OT: at('2026-05-05T10:00:00.000Z'),
    latitude_value: 16.3,
    longitude_value: 120.7,
    depth_value: 5,
    text: 'Northern Luzon, Philippines',
    isLegacyRecord: true,
    legacyImportedAt: at('2026-05-06T00:00:00.000Z'),
    legacySourcePublicID: 'legacy-2026-0505-1000',
    upForEnrichment: true,
    enrichmentAttempts: 0,
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
  },
  // No coordinates: skipped by the station check; enrichment already finished
  event({
    _id: oid('69000000000000000000e104'),
    publicID: 'upri2026jjkl',
    OT: at('2026-05-07T00:00:00.000Z'),
    latitude_value: null,
    longitude_value: null,
    magnitude_value: 2.1,
    upForEnrichment: false,
    pendingCatalogSources: [],
    catalogEnrichmentStatus: { phivolcs: 'no_match', usgs: 'no_match' },
    catalogEnrichmentAttempts: { phivolcs: 1, usgs: 1 },
    enrichmentAttempts: 1,
  }),
  // FDSN and USGS are both unreachable for this one; no place name yet
  event({
    _id: oid('69000000000000000000e105'),
    publicID: 'upri2026jmno',
    OT: at('2026-05-09T00:00:00.000Z'),
    latitude_value: 14.1,
    longitude_value: 120.9,
    magnitude_value: 3.8,
    onlineStations: ['R3B2D'],
    candidateStations: ['R3B2D'],
    last_modification: at('2026-05-09T00:03:00.000Z'),
  }),
];

const ALL_EVENTS_RANGE = '?startTime=2026-05-01T00:00:00.000Z&endTime=2026-05-10T00:00:00.000Z';

const newEventMessage = (fields = {}) => ({
  publicID: 'upri2026knew',
  OT: '2026-05-20T03:15:00.000Z',
  latitude_value: 14.62,
  longitude_value: 121.1,
  depth_value: 12,
  magnitude_value: 4.6,
  eventType: 'NEW',
  method: 'automatic',
  text: 'Luzon, Philippines',
  last_modification: '2026-05-20T03:16:00.000Z',
  ...fields,
});

// Every area pinned, so a developer's .env (which the app loads) can't decide where the data is read
const ALL_ON_MONGODB = { PEOPLE_AND_SENSORS_DB: 'mongodb', JOB_LOCKS_DB: 'mongodb', PUSH_SUBSCRIPTIONS_DB: 'mongodb', SIGNIFICANT_EQS_DB: 'mongodb' };

// overrides: the area settings that differ from ALL_ON_MONGODB
const describeEarthquakesGolden = (overrides = {}) => {
  const settings = { ...ALL_ON_MONGODB, ...overrides };
  describeEarthquakesGoldenWith(settings, Object.entries(overrides).map(([key, value]) => `${key}=${value}`).join(', ') || 'all areas on MongoDB');
};

const describeEarthquakesGoldenWith = (settings, label) => describe(`Earthquakes: recorded API responses (${label})`, () => {
  let mongo;
  let pg;
  let app;
  let EQEventsService;
  let EventsRepo;
  let adminCookie;
  const webOrigin = () => `http://${process.env.CLIENT_DEV_HOST}:${process.env.CLIENT_DEV_PORT}`;

  const send = (req, agent = null) => {
    let call = (agent || request(app))[req.method.toLowerCase()](req.path);
    Object.entries(req.headers || {}).forEach(([name, value]) => { call = call.set(name, value); });
    return req.body === undefined ? call : call.send(req.body).set('Content-Type', 'application/json');
  };
  // A session cookie is recorded as a placeholder, not the token itself
  const recorded = (req) => (req.headers?.Cookie ? { ...req, headers: { ...req.headers, Cookie: '<admin session cookie>' } } : req);
  const check = async (name, req, { agent = null, replace } = {}) => {
    const res = await send(req, agent);
    expectGolden(name, recorded(req), res, { replace });
    return res;
  };
  // A job that isn't an endpoint: its result is recorded as the body
  const checkCall = async (name, fnName, args) => {
    const result = await EQEventsService[fnName](...args);
    expectGolden(name, { method: 'CALL', path: `EQEventsService.${fnName}`, body: args }, { status: null, headers: {}, body: result });
  };

  const signIn = async (username, role, headers = {}) => {
    const agent = request.agent(app);
    const res = await send({ method: 'POST', path: '/accounts/authenticate', body: { username, password: PASSWORD, role }, headers }, agent);
    if (res.status !== 200) throw new Error(`Sign-in for ${username} failed: ${res.status}`);
    return agent;
  };
  const citizen = () => signIn('golden_citizen', 'citizen');
  const brgy = () => signIn('golden_brgy', 'brgy', { Origin: webOrigin() });
  const asAdmin = (req) => ({ ...req, headers: { ...(req.headers || {}), Cookie: adminCookie } });
  const getEvent = (publicID) => ({ method: 'GET', path: `/eq-events/${publicID}` });

  beforeAll(async () => {
    [mongo, pg] = await Promise.all([startMongo(), startPostgres()]);
    // Before the app loads: repositories pick their database, and the services read these on load
    Object.assign(process.env, pg.env, JOB_ENV, settings);
    app = require('../../src/app');
    EQEventsService = require('../../src/services/EQevents.service');
    EventsRepo = require('../../src/repositories/events.repo');
    const { generateAccessToken } = require('../../src/controllers/helpers');
    adminCookie = `accessToken=${generateAccessToken(ADMIN, 'web')}`;
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  }, Math.max(MONGO_STARTUP_TIMEOUT_MS, PG_STARTUP_TIMEOUT_MS));

  beforeEach(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'trace').mockImplementation(() => {});
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true); // the enrichment job's progress lines
    jest.spyOn(global, 'fetch').mockImplementation(External.usgsFetch);
    External.setGeoserveDown(false);
    await Promise.all([mongo.clear(), pg.clear()]);
    await mongoose.connection.collection('accounts').insertMany(ACCOUNTS);
    await mongoose.connection.collection('devices').insertMany(DEVICES);
    await mongoose.connection.collection('events').insertMany(EVENTS);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await require('../../src/db/knex').db.destroy();
    await Promise.all([mongo && mongo.stop(), pg && pg.stop()]);
  });

  describe('GET /eq-events', () => {
    test('a time range: events in stored order, place names filled in from GeoServe', () => check('eq-events.list', {
      method: 'GET', path: '/eq-events?startTime=2026-05-01T00:00:00.000Z&endTime=2026-05-06T00:00:00.000Z',
    }));
    test('a range with no events', () => check('eq-events.list.empty', {
      method: 'GET', path: '/eq-events?startTime=2025-01-01T00:00:00.000Z&endTime=2025-01-02T00:00:00.000Z',
    }));
    test('a missing endTime', () => check('eq-events.list.invalid', { method: 'GET', path: '/eq-events?startTime=2026-05-01T00:00:00.000Z' }));
  });

  describe('GET /eq-events/:publicID', () => {
    test('found (with a summary and a catalog match)', () => check('eq-events.by-id', getEvent('upri2026jdef')));
    test('not found', () => check('eq-events.by-id.not-found', getEvent('upri2026zzzz')));
    test('a publicID that is too long', () => check('eq-events.by-id.invalid', getEvent('x'.repeat(300))));
    test('a place name computed on first read is saved; without GeoServe the rest show "Unavailable"', async () => {
      await check('eq-events.place.computed', getEvent('upri2026jmno'));
      External.setGeoserveDown(true);
      await check('eq-events.place.then-saved', getEvent('upri2026jmno'));
      await check('eq-events.place.geoserve-down', getEvent('upri2026jghi'));
    });
  });

  describe('/eq-events/:publicID/summary', () => {
    const patch = (publicID, text) => ({ method: 'PATCH', path: `/eq-events/${publicID}/summary`, body: { text } });
    const del = (publicID) => ({ method: 'DELETE', path: `/eq-events/${publicID}/summary` });

    test('PATCH signed out', () => check('eq-events.summary.patch.signed-out', patch('upri2026jabc', 'Felt in Quezon City.')));
    test('PATCH with a role that may not edit (brgy)', async () => check('eq-events.summary.patch.wrong-role',
      patch('upri2026jabc', 'Felt in Quezon City.'), { agent: await brgy() }));
    test('PATCH as a citizen, then GET', async () => {
      const agent = await citizen();
      await check('eq-events.summary.patch', patch('upri2026jabc', '  Felt in Quezon City.  '), { agent });
      await check('eq-events.summary.patch.then-get', getEvent('upri2026jabc'));
    });
    test('PATCH with empty text', async () => check('eq-events.summary.patch.empty', patch('upri2026jabc', '   '), { agent: await citizen() }));
    test('PATCH an unknown event', async () => check('eq-events.summary.patch.not-found', patch('upri2026zzzz', 'Text.'), { agent: await citizen() }));
    test('DELETE signed out', () => check('eq-events.summary.delete.signed-out', del('upri2026jdef')));
    test('DELETE as a citizen, then GET', async () => {
      await check('eq-events.summary.delete', del('upri2026jdef'), { agent: await citizen() });
      await check('eq-events.summary.delete.then-get', getEvent('upri2026jdef'));
    });
    test('DELETE for an unknown event', async () => check('eq-events.summary.delete.not-found', del('upri2026zzzz'), { agent: await citizen() }));
  });

  describe('POST /messaging/restricted/new-event (SeisComP)', () => {
    const post = (fields) => ({ method: 'POST', path: '/messaging/restricted/new-event', body: newEventMessage(fields) });

    test('a new event, a newer update, then an older update that arrived late', async () => {
      await check('messaging.new-event.new', post());
      const replace = { [String((await EventsRepo.findByPublicID('upri2026knew'))._id)]: '<new event id>' };
      await check('messaging.new-event.new.then-get', getEvent('upri2026knew'), { replace });

      // Moved about 14 km: the saved place name is recomputed
      await check('messaging.new-event.newer-update', post({
        eventType: 'UPDATE', latitude_value: 14.75, magnitude_value: 4.8, last_modification: '2026-05-20T03:20:00.000Z',
      }));
      await check('messaging.new-event.newer-update.then-get', getEvent('upri2026knew'), { replace });

      await check('messaging.new-event.older-update', post({
        eventType: 'UPDATE', magnitude_value: 3.0, last_modification: '2026-05-20T03:18:00.000Z',
      }));
      await check('messaging.new-event.older-update.then-get', getEvent('upri2026knew'), { replace });
    });
    test('an invalid message', () => check('messaging.new-event.invalid', post({ latitude_value: 95 })));
  });

  describe('station check (which nearby stations recorded each event)', () => {
    const run = { method: 'POST', path: '/eq-events/restricted/update-online-stations' };

    test('POST /eq-events/restricted/update-online-stations signed out', () => check('eq-events.update-online-stations.signed-out', run));
    test('... as a citizen', async () => check('eq-events.update-online-stations.wrong-role', run, { agent: await citizen() }));
    test('... as an admin: every event with coordinates, then the list', async () => {
      await check('eq-events.update-online-stations', asAdmin(run));
      await check('eq-events.update-online-stations.then-list', { method: 'GET', path: `/eq-events${ALL_EVENTS_RANGE}` });
    });
    test('one event (as after ingest), then GET', async () => {
      await checkCall('eq-events.station-check.one-event', 'updateOnlineStationsForEvent', ['upri2026jabc']);
      await check('eq-events.station-check.one-event.then-get', getEvent('upri2026jabc'));
    });
    test('one event whose station lookups all fail, then GET', async () => {
      await checkCall('eq-events.station-check.all-lookups-failed', 'updateOnlineStationsForEvent', ['upri2026jmno']);
      await check('eq-events.station-check.all-lookups-failed.then-get', getEvent('upri2026jmno'));
    });
  });

  describe('catalog enrichment (PHIVOLCS and USGS matches)', () => {
    const run = { method: 'POST', path: '/eq-events/restricted/scrape-additional-information' };

    test('POST /eq-events/restricted/scrape-additional-information signed out', () => check('eq-events.scrape-additional-information.signed-out', run));
    test('... as a citizen', async () => check('eq-events.scrape-additional-information.wrong-role', run, { agent: await citizen() }));
    test('... as an admin: matches, no match, missing magnitude and an unreachable USGS, then the list', async () => {
      await check('eq-events.scrape-additional-information', asAdmin(run));
      await check('eq-events.scrape-additional-information.then-list', { method: 'GET', path: `/eq-events${ALL_EVENTS_RANGE}` });
    });
  });
});

module.exports = { describeEarthquakesGolden };
