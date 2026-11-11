// scripts/seed-dev-data.js (npm run db:pg:seed) on an empty, migrated database: what it adds, that a second
// run adds nothing, and that the app then works on the seeded data as FRONTEND_BACKEND_TEST_PLAN.md expects
jest.mock('../src/services/email.service', () => ({ sendMail: jest.fn().mockResolvedValue({}) }));
jest.mock('axios', () => ({ get: jest.fn().mockRejectedValue(new Error('no network in tests')), create: jest.fn() }));

const request = require('supertest');
const { startPostgres, PG_STARTUP_TIMEOUT_MS } = require('./fixtures/postgres.fixture');
const { seedDevData, QA_PASSWORD } = require('../scripts/seed-dev-data');

describe('npm run db:pg:seed', () => {
  let pg;
  let app;
  let first;
  const quiet = { log: () => {} };
  const count = async (table) => Number((await pg.db(table).count({ n: '*' }).first()).n);

  beforeAll(async () => {
    pg = await startPostgres();
    Object.assign(process.env, pg.env);
    app = require('../src/app');
    first = await seedDevData({ db: pg.db, ...quiet });
  }, PG_STARTUP_TIMEOUT_MS);

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await require('../src/db/knex').db.destroy();
    if (pg) await pg.stop();
  });

  test('adds the earthquakes with their rows, and the made-up accounts and sensors', async () => {
    expect(first.events).toEqual({ added: 906, existing: 0 });
    expect(await count('events')).toBe(906);
    expect(await count('event_catalog_matches')).toBe(1204);
    expect(await count('event_catalog_status')).toBe(1812);
    expect(await count('event_stations')).toBe(6548);
    expect(first.stations.withoutSensor).toBe(0);
    expect((await pg.db('accounts').orderBy('username').pluck('username')).map(String))
      .toEqual(['qa_brgy', 'qa_citizen_1', 'qa_citizen_2', 'qa_sensor_owner']);
    expect(await count('devices')).toBe(17);
    expect(await count('brgy_forwarded_devices')).toBe(2);
  });

  test('a second run adds nothing', async () => {
    const again = await seedDevData({ db: pg.db, ...quiet });

    expect(again.events).toEqual({ added: 0, existing: 906 });
    expect(again.accounts).toEqual({ added: 0, existing: 4 });
    expect(again.devices).toEqual({ added: 0, existing: 17 });
    expect(again.forwarding).toEqual({ added: 0, existing: 2 });
    expect(await count('event_catalog_matches')).toBe(1204);
  });

  test('the test accounts sign in with the documented password', async () => {
    const citizen = await request(app).post('/accounts/authenticate').send({ identifier: 'qa_citizen_1', password: QA_PASSWORD, role: 'citizen' });
    const owner = request.agent(app);
    await owner.post('/accounts/authenticate').send({ identifier: 'qa_sensor_owner', password: QA_PASSWORD, role: 'citizen' });

    expect(citizen.status).toBe(200);
    expect((await owner.get('/device/my-devices')).body.devices).toHaveLength(3);
  });

  test('the significant earthquakes page gets the 16 the test plan expects', async () => {
    const { payload } = (await request(app).get('/significant-eqs/all')).body;

    expect(payload).toHaveLength(16);
    expect(payload[0].title).toBe('M7.8 Earthquake, 24 km SW of Soccsksargen, Philippines');
  });
});
