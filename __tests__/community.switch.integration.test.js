// Every area switched to PostgreSQL, community last (COMMUNITY_DB=postgres), after copying: sessions
// from before the switch keep posting and marking comments, copied comments keep their event, author,
// marks and ids, and the backend sends MongoDB nothing while doing it.
jest.mock('../src/services/email.service', () => ({ sendMail: jest.fn().mockResolvedValue({}) }));

const request = require('supertest');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { copyPeopleAndSensors } = require('../scripts/copy-people-and-sensors-to-postgres');
const { copyEarthquakes } = require('../scripts/copy-earthquakes-to-postgres');
const { copyCommunity } = require('../scripts/copy-community-to-postgres');
const { generateAccessToken } = require('../src/controllers/helpers');
const { startMongo, MONGO_STARTUP_TIMEOUT_MS } = require('./fixtures/mongo.fixture');
const { startPostgres, PG_STARTUP_TIMEOUT_MS } = require('./fixtures/postgres.fixture');

const PASSWORD = 'Golden-Password-2026!';
const oid = (hex) => new mongoose.Types.ObjectId(hex);
const JUAN_ID = oid('6d0000000000000000000a01');
const ANA_ID = oid('6d0000000000000000000a02');
const EVENT_ID = oid('6d0000000000000000000e01');
const COPIED_COMMENT = 'd0000000-0000-4000-8000-000000000001';
const ALL_ON_POSTGRES = {
  JOB_LOCKS_DB: 'postgres', PUSH_SUBSCRIPTIONS_DB: 'postgres', PEOPLE_AND_SENSORS_DB: 'postgres', EARTHQUAKES_DB: 'postgres', COMMUNITY_DB: 'postgres',
};

const account = (_id, username) => ({
  _id,
  username,
  email: `${username}@example.org`,
  password: bcrypt.hashSync(PASSWORD, 4),
  roles: ['citizen'],
  passwordPolicyVersion: 2,
  devices: [],
  releasedDevices: [],
  createdAt: new Date('2025-01-01T00:00:00.000Z'),
  updatedAt: new Date('2025-01-01T00:00:00.000Z'),
});

describe('community switched to PostgreSQL (every area on PostgreSQL)', () => {
  let mongo;
  let pg;
  let app;
  let juanOldSession;
  let mongoOps;

  beforeAll(async () => {
    [mongo, pg] = await Promise.all([startMongo(), startPostgres()]);

    // Before the switch: accounts, an event and a comment (by Ana, marked helpful by Juan) in MongoDB,
    // and a session the MongoDB backend issued to Juan
    await mongoose.connection.collection('accounts').insertMany([account(JUAN_ID, 'juan'), account(ANA_ID, 'ana')]);
    await mongoose.connection.collection('events').insertOne({
      _id: EVENT_ID, publicID: 'upri2026swch', OT: new Date('2026-05-01T08:00:00.000Z'), latitude_value: 14.6, longitude_value: 121, text: 'Luzon, Philippines',
    });
    await mongoose.connection.collection('comments').insertOne({
      commentId: COPIED_COMMENT,
      eventId: EVENT_ID,
      eventPublicID: 'upri2026swch',
      accountId: ANA_ID,
      username: 'ana',
      content: 'Strong shaking in Quezon City.',
      status: 'approved',
      helpfulAccountIds: [JUAN_ID],
      issueReports: [],
      createdAt: new Date('2026-05-02T00:00:00.000Z'),
      updatedAt: new Date('2026-05-02T00:00:00.000Z'),
    });
    juanOldSession = `accessToken=${generateAccessToken({ accountId: String(JUAN_ID), username: 'juan', role: 'citizen' }, 'web')}`;

    // The switch: copy every area, then point all of them at PostgreSQL
    const quiet = { db: pg.db, log: () => {} };
    for (const copy of [copyPeopleAndSensors, copyEarthquakes, copyCommunity]) {
      if (!(await copy(quiet)).ok) throw new Error(`${copy.name} failed`);
    }
    Object.assign(process.env, pg.env, ALL_ON_POSTGRES, { REPORT_POST_RATE_LIMIT_MAX: '1000', COMMENTS_DEFAULT_STATUS: 'approved' });
    app = require('../src/app');
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  }, Math.max(MONGO_STARTUP_TIMEOUT_MS, PG_STARTUP_TIMEOUT_MS));

  // Every operation the backend sends MongoDB through Mongoose during a test
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    mongoOps = [];
    mongoose.set('debug', (collection, method) => mongoOps.push(`${collection}.${method}`));
  });

  afterEach(() => {
    mongoose.set('debug', false);
    expect(mongoOps).toEqual([]);
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await require('../src/db/knex').db.destroy();
    await Promise.all([mongo && mongo.stop(), pg && pg.stop()]);
  });

  const points = async (accountId) => pg.db('contribution_events AS ce').join('accounts AS a', 'a.id', 'ce.account_id')
    .where('a.legacy_mongo_id', String(accountId)).orderByRaw('ce.action_type::text').pluck('ce.action_type');

  test('a copied comment still lists under its event, with its author\'s mark from before the switch', async () => {
    const res = await request(app).get(`/comments?eventId=${EVENT_ID}`).set('Cookie', juanOldSession);

    expect(res.status).toBe(200);
    expect(res.body.payload).toEqual([expect.objectContaining({
      commentId: COPIED_COMMENT, username: 'ana', helpfulCount: 1, viewerHasMarkedHelpful: true,
    })]);
  });

  test('a session from before the switch can post, under the same account id; the points are recorded once', async () => {
    const res = await request(app).post('/comments').set('Cookie', juanOldSession)
      .send({ eventId: String(EVENT_ID), content: 'Felt it in Marikina.', anonymous: false });

    expect(res.status).toBe(201);
    const stored = await pg.db('comments AS c').join('accounts AS a', 'a.id', 'c.account_id')
      .where('c.comment_id', res.body.payload.commentId).first('a.legacy_mongo_id', 'c.username');
    expect(stored).toEqual({ legacy_mongo_id: String(JUAN_ID), username: 'juan' });
    expect(await points(JUAN_ID)).toEqual(['report_posted']);
    // (the driver's own collection: Mongoose's would count as a backend operation)
    expect(await mongoose.connection.db.collection('comments').countDocuments({ content: 'Felt it in Marikina.' })).toBe(0);
  });

  test('a session from before the switch can unmark and mark again: the points are not counted twice', async () => {
    const unmark = await request(app).delete(`/comments/${COPIED_COMMENT}/helpful`).set('Cookie', juanOldSession);
    expect(unmark.body.payload).toMatchObject({ helpfulCount: 0, viewerHasMarkedHelpful: false });

    const mark = await request(app).put(`/comments/${COPIED_COMMENT}/helpful`).set('Cookie', juanOldSession);
    expect(mark.body.payload).toMatchObject({ helpfulCount: 1, viewerHasMarkedHelpful: true });
    const again = await request(app).put(`/comments/${COPIED_COMMENT}/helpful`).set('Cookie', juanOldSession);
    expect(again.body.payload).toMatchObject({ helpfulCount: 1 });

    expect(await points(JUAN_ID)).toEqual(['report_marked_helpful', 'report_posted']);
    expect(await points(ANA_ID)).toEqual(['report_received_helpful']);
  });

  test('admin responses keep the event\'s and author\'s MongoDB ids', async () => {
    const admin = `accessToken=${generateAccessToken({ accountId: '6d0000000000000000000aad', username: 'admin', role: 'admin' }, 'web')}`;
    const res = await request(app).patch(`/comments/${COPIED_COMMENT}/status`).set('Cookie', admin).send({ status: 'approved' });

    expect(res.status).toBe(200);
    expect(res.body.payload).toMatchObject({ eventId: String(EVENT_ID), eventPublicID: 'upri2026swch', accountId: String(ANA_ID), moderatedBy: 'admin' });
  });

  test('a user created after the switch can comment and report an issue', async () => {
    const register = await request(app).post('/accounts/register').send({
      role: 'citizen', username: 'maria', email: 'maria@example.org', password: PASSWORD, confirmPassword: PASSWORD,
    });
    expect(register.status).toBe(200);
    const agent = request.agent(app);
    await agent.post('/accounts/authenticate').send({ username: 'maria', password: PASSWORD, role: 'citizen' });

    expect((await agent.post('/comments').send({ eventId: String(EVENT_ID), content: 'Felt it too.', anonymous: false })).status).toBe(201);
    expect((await agent.post(`/comments/${COPIED_COMMENT}/issues`).send({ reason: 'unclear' })).status).toBe(200);
    const maria = (await pg.db('accounts').where({ username: 'maria' }).first()).legacy_mongo_id;
    expect(await points(maria)).toEqual(['report_issue_submitted', 'report_posted']);
  });
});
