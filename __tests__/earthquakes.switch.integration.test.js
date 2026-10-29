// Event ids with earthquakes on PostgreSQL (EARTHQUAKES_DB=postgres) while comments and contributions
// stay on MongoDB (until Step 4). They store an event's id as a MongoDB ObjectId, so:
//   - a copied event keeps its old _id, and comments made before the switch still list under it
//   - an event SeisComP sends after the switch gets a new ObjectId, which comments and contributions use
jest.mock('../src/services/email.service', () => ({ sendMail: jest.fn().mockResolvedValue({}) }));
jest.mock('axios', () => ({ get: () => Promise.reject(new Error('no network in tests')) }));

const request = require('supertest');
const mongoose = require('mongoose');
const { copyEarthquakes } = require('../scripts/copy-earthquakes-to-postgres');
const { startMongo, MONGO_STARTUP_TIMEOUT_MS } = require('./fixtures/mongo.fixture');
const { startPostgres, PG_STARTUP_TIMEOUT_MS } = require('./fixtures/postgres.fixture');

const PASSWORD = 'Switch-Password-2026!';
const OLD_EVENT_ID = '6c0000000000000000000e01';

describe('event ids with EARTHQUAKES_DB=postgres (comments still on MongoDB)', () => {
  let mongo;
  let pg;
  let app;
  const collection = (name) => mongoose.connection.collection(name);
  const commentsOf = async (eventId) => (await request(app).get(`/comments?eventId=${eventId}`)).body.payload.map((c) => c.content);

  beforeAll(async () => {
    [mongo, pg] = await Promise.all([startMongo(), startPostgres()]);
    Object.assign(process.env, pg.env, {
      EARTHQUAKES_DB: 'postgres',
      PEOPLE_AND_SENSORS_DB: 'postgres',
      COMMENTS_DEFAULT_STATUS: 'approved',
      ONLINE_STATION_REFINEMENT_DELAY_MS: String(60 * 60 * 1000), // not during the test
    });
    app = require('../src/app');
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  }, Math.max(MONGO_STARTUP_TIMEOUT_MS, PG_STARTUP_TIMEOUT_MS));

  beforeEach(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await Promise.all([mongo.clear(), pg.clear()]);

    // Before the switch: an event, and a comment on it, both in MongoDB; then the event is copied
    const eventId = new mongoose.Types.ObjectId(OLD_EVENT_ID);
    await collection('events').insertOne({
      _id: eventId, publicID: 'upri2026jold', OT: new Date('2026-05-01T08:00:00.000Z'), latitude_value: 14.67, longitude_value: 121.06,
      depth_value: 10, magnitude_value: 4.5, type: 'UPDATE', text: 'Luzon, Philippines', place: '3 km N of Quezon City, Philippines',
    });
    await collection('comments').insertOne({
      commentId: 'before-the-switch', eventId, eventPublicID: 'upri2026jold', username: 'Anonymous', content: 'Felt it (before the switch)',
      status: 'approved', createdAt: new Date('2026-05-01T09:00:00.000Z'), updatedAt: new Date('2026-05-01T09:00:00.000Z'),
    });
    const copied = await copyEarthquakes({ db: pg.db, log: () => {} });
    if (!copied.ok) throw new Error('copy failed');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await require('../src/db/knex').db.destroy();
    await Promise.all([mongo && mongo.stop(), pg && pg.stop()]);
  });

  test('a copied event keeps its MongoDB _id; comments from before and after the switch list under it', async () => {
    const { body } = await request(app).get('/eq-events/upri2026jold');
    expect(body.payload._id).toBe(OLD_EVENT_ID);

    const posted = await request(app).post('/comments').send({ eventId: OLD_EVENT_ID, content: 'Felt it (after the switch)' });
    expect(posted.status).toBe(201);

    expect(await commentsOf(OLD_EVENT_ID)).toEqual(expect.arrayContaining(['Felt it (before the switch)', 'Felt it (after the switch)']));
    expect(await collection('comments').findOne({ content: 'Felt it (after the switch)' }))
      .toMatchObject({ eventId: new mongoose.Types.ObjectId(OLD_EVENT_ID), eventPublicID: 'upri2026jold' });
  });

  test('an event SeisComP sends after the switch gets a new ObjectId; comments and contributions use it', async () => {
    const sent = await request(app).post('/messaging/restricted/new-event').send({
      publicID: 'upri2026knew', OT: '2026-05-20T03:15:00.000Z', latitude_value: 14.62, longitude_value: 121.1, depth_value: 12,
      magnitude_value: 4.6, eventType: 'NEW', method: 'automatic', text: 'Luzon, Philippines', last_modification: '2026-05-20T03:16:00.000Z',
    });
    expect(sent.status).toBe(200);
    const newId = (await request(app).get('/eq-events/upri2026knew')).body.payload._id;
    expect(newId).toMatch(/^[0-9a-f]{24}$/);
    expect(await collection('events').countDocuments({ publicID: 'upri2026knew' })).toBe(0); // only in PostgreSQL

    await request(app).post('/accounts/register').send({
      role: 'citizen', username: 'juan', email: 'juan@example.org', password: PASSWORD, confirmPassword: PASSWORD,
    });
    const agent = request.agent(app);
    await agent.post('/accounts/authenticate').send({ username: 'juan', password: PASSWORD, role: 'citizen' });
    const posted = await agent.post('/comments').send({ eventId: newId, content: 'Strong shaking here', anonymous: false });
    expect(posted.status).toBe(201);

    expect(await commentsOf(newId)).toEqual(['Strong shaking here']);
    expect(await collection('contributionevents').findOne({ actionType: 'report_posted' }))
      .toMatchObject({ eventId: new mongoose.Types.ObjectId(newId), eventPublicID: 'upri2026knew' });
  });

  test('an unknown event id is a 404, as before', async () => {
    const res = await request(app).post('/comments').send({ eventId: '6c0000000000000000000e99', content: 'Where?' });

    expect(res.status).toBe(404);
  });
});
