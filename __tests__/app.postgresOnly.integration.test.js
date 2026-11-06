// The app with every area on PostgreSQL and no MongoDB at all: no MongoDB container, no connection, and
// the area settings unset (as in .env.example), so each area takes its default. The main flows must work:
// sign in, list events, post and list comments, and my devices.
//
// Mongoose's command buffering is off, so any MongoDB call fails at once instead of waiting for a
// connection; and no Mongoose model may even be loaded.
jest.mock('../src/services/email.service', () => ({ sendMail: jest.fn().mockResolvedValue({}) }));
jest.mock('axios', () => ({ get: jest.fn().mockRejectedValue(new Error('no network in tests')), create: jest.fn() }));

const request = require('supertest');
const mongoose = require('mongoose');
const { startPostgres, PG_STARTUP_TIMEOUT_MS } = require('./fixtures/postgres.fixture');
const { generateAMStationCode } = require('../src/controllers/helpers');

const PASSWORD = 'Postgres-Only-2026!';
const MAC = 'B8:27:EB:34:CD:EF';
const STATION = generateAMStationCode(MAC);
const STREAM_ID = `AM_${STATION}_.*/MSEED`;
const PUBLIC_ID = 'upri2026pgonly';

describe('the app with every area on PostgreSQL and no MongoDB', () => {
  let pg;
  let app;
  let areaLogs;

  const signIn = (identifier, agent = request(app)) => agent.post('/accounts/authenticate')
    .send({ identifier, password: PASSWORD, role: 'citizen' });
  const signedIn = async () => {
    const agent = request.agent(app);
    const res = await signIn('maria', agent);
    if (res.status !== 200) throw new Error(`sign-in failed: ${res.status}`);
    return agent;
  };
  const addEvent = () => request(app).post('/messaging/restricted/new-event').send({
    publicID: PUBLIC_ID,
    OT: '2026-05-20T03:15:00.000Z',
    latitude_value: 14.62,
    longitude_value: 121.1,
    depth_value: 12,
    magnitude_value: 4.6,
    eventType: 'NEW',
    method: 'automatic',
    text: 'Luzon, Philippines',
    last_modification: '2026-05-20T03:16:00.000Z',
  });
  const listEvents = () => request(app).get('/eq-events?startTime=2026-05-01T00:00:00.000Z&endTime=2026-06-01T00:00:00.000Z');

  beforeAll(async () => {
    pg = await startPostgres();
    // The area settings are already empty (fixtures/integrationEnv.js), so each area takes its default
    Object.assign(process.env, pg.env, { COMMENTS_DEFAULT_STATUS: 'approved' });
    mongoose.set('bufferCommands', false);

    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    app = require('../src/app');
    require('../src/repositories/jobLocks.repo'); // the background jobs' area, which the routes don't load
    areaLogs = log.mock.calls.map(([line]) => String(line)).filter((line) => line.startsWith('[db] '));
    log.mockRestore();
  }, PG_STARTUP_TIMEOUT_MS);

  beforeEach(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await pg.clear();
    const res = await request(app).post('/accounts/register').send({
      role: 'citizen', username: 'maria', email: 'maria@example.org', password: PASSWORD, confirmPassword: PASSWORD,
    });
    if (res.status !== 200) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await require('../src/db/knex').db.destroy();
    if (pg) await pg.stop();
  });

  test('starts with every area on PostgreSQL, without connecting to MongoDB or loading a Mongoose model', () => {
    expect(areaLogs).toEqual(expect.arrayContaining([
      '[db] accounts: postgres (PEOPLE_AND_SENSORS_DB)',
      '[db] devices: postgres (PEOPLE_AND_SENSORS_DB)',
      '[db] earthquake events: postgres (EARTHQUAKES_DB)',
      '[db] comments: postgres (COMMUNITY_DB)',
      '[db] contribution points: postgres (COMMUNITY_DB)',
      '[db] job locks: postgres (JOB_LOCKS_DB)',
    ]));
    expect(areaLogs.filter((line) => !line.includes(': postgres ('))).toEqual([]);
    expect(mongoose.connection.readyState).toBe(0); // disconnected: nothing ever connected
    expect(mongoose.modelNames()).toEqual([]);
  });

  test('sign in', async () => {
    const res = await signIn('maria');

    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']).toEqual(expect.arrayContaining([expect.stringMatching(/^accessToken=/)]));
    expect(await pg.db('accounts').where({ username: 'maria' }).first()).toBeTruthy();
  });

  test('list events', async () => {
    expect((await addEvent()).status).toBe(200);

    const res = await listEvents();

    expect(res.status).toBe(200);
    expect(res.body.payload).toEqual([expect.objectContaining({ publicID: PUBLIC_ID, magnitude_value: 4.6 })]);
    expect(await pg.db('events').where({ public_id: PUBLIC_ID }).first()).toBeTruthy();
  });

  test('post and list comments', async () => {
    await addEvent();
    const eventId = (await listEvents()).body.payload[0]._id;
    const agent = await signedIn();

    const posted = await agent.post('/comments').send({ eventId, content: 'Felt it in Pasig.', anonymous: false });
    const listed = await request(app).get(`/comments?eventId=${eventId}&limit=20`);

    expect(posted.status).toBe(201);
    expect(posted.body.payload).toMatchObject({ username: 'maria', content: 'Felt it in Pasig.', status: 'approved' });
    expect(listed.status).toBe(200);
    expect(listed.body.payload).toEqual([expect.objectContaining({ commentId: posted.body.payload.commentId, username: 'maria', content: 'Felt it in Pasig.' })]);
    expect(await pg.db('comments').where({ content: 'Felt it in Pasig.' }).first()).toBeTruthy();
  });

  test('my devices', async () => {
    const linked = await request(app).post('/device/link').send({
      username: 'maria', password: PASSWORD, role: 'sensor', elevation: '55', latitude: '14.58', longitude: '121.08', macAddress: MAC, streamId: STREAM_ID,
    });

    const res = await (await signedIn()).get('/device/my-devices');

    expect(linked.body.message).toBe('Device-Account Linking Successful');
    expect(res.status).toBe(200);
    expect(res.body.devices).toEqual([expect.objectContaining({ station: STATION, network: 'AM' })]);
    expect(await pg.db('devices').where({ station: STATION }).first()).toBeTruthy();
  });
});
