// Golden-file tests for the Pilot areas of the PostgreSQL migration (push subscriptions; significant
// earthquakes were removed). They run the real app against seeded databases and compare each response with its
// recording in __tests__/golden/. Each pilotAreas.golden.*.integration.test.js runs these cases with
// one combination of area settings, so every setting must give identical responses.
const request = require('supertest');
const mongoose = require('mongoose');
const { startMongo, MONGO_STARTUP_TIMEOUT_MS } = require('./mongo.fixture');
const { startPostgres, PG_STARTUP_TIMEOUT_MS } = require('./postgres.fixture');
const { expectGolden } = require('./golden');

const SUBSCRIPTION = {
  endpoint: 'https://push.example.org/wpush/v2/golden-subscriber',
  expirationTime: null,
  keys: { p256dh: 'BLuuTRceHGlpTdepbGlthyMlQM_I1WvqcLLONsg-zQ7aaAlRFO6DfmSSMGU', auth: 'qIwUJpYMw1E2Xa9vXOH-_Q' },
  clientMeta: {
    swScriptUrl: 'https://earthquake.up.edu.ph/sw.js',
    userAgent: 'Mozilla/5.0 (golden test)',
    appVersion: '1.0.0',
    time: '2026-01-01T00:00:00.000Z',
  },
};

let app;

const send = (req) => {
  const call = request(app)[req.method.toLowerCase()](req.path);
  return req.body === undefined ? call : call.send(req.body).set('Content-Type', 'application/json');
};

// settings: the area settings to run the app with, e.g. { PUSH_SUBSCRIPTIONS_DB: 'postgres' }
const describePilotAreasGolden = (settings) => describe(`Pilot areas: recorded API responses (${
  Object.entries(settings).map(([key, value]) => `${key}=${value}`).join(', ')
})`, () => {
  let mongo;
  let pg;

  beforeAll(async () => {
    [mongo, pg] = await Promise.all([startMongo(), startPostgres()]);
    // Before the app loads: repositories pick their database, and src/db/knex.js its connection, on load
    Object.assign(process.env, pg.env, settings);
    app = require('../../src/app');
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  }, Math.max(MONGO_STARTUP_TIMEOUT_MS, PG_STARTUP_TIMEOUT_MS));

  beforeEach(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    await Promise.all([mongo.clear(), pg.clear()]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await require('../../src/db/knex').db.destroy();
    await Promise.all([mongo && mongo.stop(), pg && pg.stop()]);
  });

  describe('POST /notifications/subscribe', () => {
    test('creates a new subscription', async () => {
      const req = { method: 'POST', path: '/notifications/subscribe', body: SUBSCRIPTION };
      expectGolden('notifications.subscribe.new', req, await send(req));
    });

    test('with an endpoint that is already subscribed', async () => {
      const req = { method: 'POST', path: '/notifications/subscribe', body: SUBSCRIPTION };
      await send(req);
      expectGolden('notifications.subscribe.existing', req, await send(req));
    });

    test('with an invalid body', async () => {
      const req = { method: 'POST', path: '/notifications/subscribe', body: { endpoint: 'not-a-uri' } };
      expectGolden('notifications.subscribe.invalid', req, await send(req));
    });
  });
});

module.exports = { describePilotAreasGolden };
