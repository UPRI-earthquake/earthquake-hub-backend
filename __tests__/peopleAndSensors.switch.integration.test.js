// Accounts switched to PostgreSQL (PEOPLE_AND_SENSORS_DB=postgres) while comments stay on MongoDB:
// sessions from before the switch keep working, and users created after it can still comment, because
// session tokens carry the account's MongoDB-style id (legacyId).
jest.mock('../src/services/email.service', () => ({ sendMail: jest.fn().mockResolvedValue({}) }));

const request = require('supertest');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { copyPeopleAndSensors } = require('../scripts/copy-people-and-sensors-to-postgres');
const { generateAccessToken } = require('../src/controllers/helpers');
const { startMongo, MONGO_STARTUP_TIMEOUT_MS } = require('./fixtures/mongo.fixture');
const { startPostgres, PG_STARTUP_TIMEOUT_MS } = require('./fixtures/postgres.fixture');

const PASSWORD = 'Golden-Password-2026!';
const JUAN_ID = new mongoose.Types.ObjectId('6b0000000000000000000a01');
const EVENT_ID = new mongoose.Types.ObjectId('6b0000000000000000000e01');

const tokenClaims = (res) => {
  const cookie = (res.headers['set-cookie'] || []).find((c) => c.startsWith('accessToken='));
  const token = cookie.split(';')[0].slice('accessToken='.length);
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
};

describe('accounts on PostgreSQL, comments on MongoDB', () => {
  let mongo;
  let pg;
  let app;
  let oldSessionCookie;

  beforeAll(async () => {
    [mongo, pg] = await Promise.all([startMongo(), startPostgres()]);

    // Before the switch: an account and an event in MongoDB, and a session issued by the MongoDB backend
    await mongoose.connection.collection('accounts').insertOne({
      _id: JUAN_ID,
      username: 'juan',
      email: 'juan@example.org',
      password: bcrypt.hashSync(PASSWORD, 4),
      roles: ['citizen', 'sensor'],
      passwordPolicyVersion: 2,
      devices: [],
      releasedDevices: [],
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    });
    await mongoose.connection.collection('events').insertOne({ _id: EVENT_ID, publicID: 'upri2026abcd' });
    oldSessionCookie = `accessToken=${generateAccessToken({ accountId: String(JUAN_ID), username: 'juan', role: 'citizen' }, 'web')}`;

    // The switch: copy, then point accounts and devices at PostgreSQL
    const { ok } = await copyPeopleAndSensors({ db: pg.db, log: () => {} });
    if (!ok) throw new Error('copy failed');
    Object.assign(process.env, pg.env, { PEOPLE_AND_SENSORS_DB: 'postgres' });
    app = require('../src/app');
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  }, Math.max(MONGO_STARTUP_TIMEOUT_MS, PG_STARTUP_TIMEOUT_MS));

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await require('../src/db/knex').db.destroy();
    await Promise.all([mongo && mongo.stop(), pg && pg.stop()]);
  });

  test('a session from before the switch still works', async () => {
    const res = await request(app).get('/accounts/profile').set('Cookie', oldSessionCookie);

    expect(res.status).toBe(200);
    expect(res.body.payload).toMatchObject({ username: 'juan', email: 'juan@example.org' });
  });

  test('a session from before the switch can comment, under the same account id as before', async () => {
    const res = await request(app).post('/comments').set('Cookie', oldSessionCookie)
      .send({ eventId: String(EVENT_ID), content: 'Felt strong shaking', anonymous: false });

    expect(res.status).toBe(201);
    const comment = await mongoose.connection.collection('comments').findOne({ content: 'Felt strong shaking' });
    expect(String(comment.accountId)).toBe(String(JUAN_ID));
  });

  test('signing in to a copied account puts its old MongoDB id in the token', async () => {
    const res = await request(app).post('/accounts/authenticate')
      .send({ username: 'JUAN', password: PASSWORD, role: 'citizen' }); // usernames now ignore case

    expect(res.status).toBe(200);
    expect(tokenClaims(res)).toMatchObject({ accountId: String(JUAN_ID), username: 'juan' });
  });

  test('a user created after the switch gets a MongoDB-style id and can comment', async () => {
    const register = await request(app).post('/accounts/register').send({
      role: 'citizen', username: 'maria', email: 'maria@example.org', password: PASSWORD, confirmPassword: PASSWORD,
    });
    expect(register.status).toBe(200);
    expect(await mongoose.connection.collection('accounts').countDocuments({ username: 'maria' })).toBe(0); // created in PostgreSQL only

    const agent = request.agent(app);
    const signIn = await agent.post('/accounts/authenticate').send({ username: 'maria', password: PASSWORD, role: 'citizen' });
    const { accountId } = tokenClaims(signIn);
    expect(accountId).toMatch(/^[0-9a-f]{24}$/);
    expect((await pg.db('accounts').where({ username: 'maria' }).first()).legacy_mongo_id).toBe(accountId);

    const comment = await agent.post('/comments').send({ eventId: String(EVENT_ID), content: 'Felt it too', anonymous: false });

    expect(comment.status).toBe(201);
    const stored = await mongoose.connection.collection('comments').findOne({ content: 'Felt it too' });
    expect(String(stored.accountId)).toBe(accountId);
  });
});
