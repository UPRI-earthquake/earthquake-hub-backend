// Golden-file tests for Community (comments and contribution points) of the PostgreSQL migration. They
// run the real app against seeded data and compare each response with its recording in
// __tests__/golden/. Each community.golden.*.integration.test.js runs these cases with one set of area
// settings, so every setting must give identical responses.
//
// Points aren't returned by any endpoint: after each request that can write them, the stored entries are
// recorded the same way (or checked to be unchanged), read from where the area keeps them.
//
// The data is always seeded in MongoDB. Each area on PostgreSQL is then copied with the real copy scripts
// (accounts, then events, then comments and points) and removed from MongoDB, so the responses come
// from where the settings say. The seeded records only hold what both databases can represent.
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { startMongo, MONGO_STARTUP_TIMEOUT_MS } = require('./mongo.fixture');
const { startPostgres, PG_STARTUP_TIMEOUT_MS } = require('./postgres.fixture');
const { expectGolden } = require('./golden');
const { copyPeopleAndSensors } = require('../../scripts/copy-people-and-sensors-to-postgres');
const { copyEarthquakes } = require('../../scripts/copy-earthquakes-to-postgres');
const { copyCommunity } = require('../../scripts/copy-community-to-postgres');

const oid = (hex) => new mongoose.Types.ObjectId(hex);
const at = (iso) => new Date(iso);

const PASSWORD = 'Golden-Password-2026!';
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 10);
const SEEDED_AT = at('2026-05-10T00:00:00.000Z');
// A 1x1 PNG, for the image-only report
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

// --- Seeded data ---

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
  roles: ['citizen'],
  ...fields,
});

const CITIZEN_ID = '69000000000000000000a301';
const AUTHOR_ID = '69000000000000000000a302';
const ACCOUNTS = [
  account({ _id: oid(CITIZEN_ID), username: 'golden_citizen', email: 'golden.citizen@example.org' }),
  account({ _id: oid(AUTHOR_ID), username: 'golden_author', email: 'golden.author@example.org' }),
];
// Admins have no sign-in endpoint: their session token is minted directly (see adminCookie)
const ADMIN = { accountId: '69000000000000000000a3ad', username: 'golden_admin', role: 'admin' };

// An event as SeisComP ingest stores it
const event = (fields) => ({
  sourceCatalog: 'upri-current',
  sourceServer: 'earthquake.up.edu.ph',
  isLegacyRecord: false,
  legacyImportedAt: null,
  legacySourcePublicID: null,
  depth_value: 10,
  magnitude_value: 4.5,
  type: 'NEW',
  text: 'Luzon, Philippines',
  onlineStations: [],
  candidateStations: [],
  recordingStations: [],
  recordingAvailabilityStatus: 'pending',
  recordingAvailabilityAttempts: 0,
  upForEnrichment: false,
  enrichmentAttempts: 1,
  additionalInformation: [],
  pendingCatalogSources: [],
  catalogEnrichmentAttempts: { phivolcs: 1, usgs: 1 },
  catalogEnrichmentStatus: { phivolcs: 'no_match', usgs: 'no_match' },
  summaryOverride: null,
  createdAt: SEEDED_AT,
  updatedAt: SEEDED_AT,
  __v: 0,
  location: { type: 'Point', coordinates: [fields.longitude_value, fields.latitude_value] },
  ...fields,
});

const EVENT_ID = '69000000000000000000e301';
const QUIET_EVENT_ID = '69000000000000000000e302';
const UNKNOWN_EVENT_ID = '69000000000000000000e3ee';
const EVENTS = [
  event({
    _id: oid(EVENT_ID),
    publicID: 'upri2026jcom',
    OT: at('2026-05-01T08:00:00.000Z'),
    latitude_value: 14.67,
    longitude_value: 121.06,
    place: '3 km N of Quezon City, Metro Manila, Philippines',
    last_modification: at('2026-05-01T08:05:00.000Z'),
  }),
  // No comments
  event({
    _id: oid(QUIET_EVENT_ID),
    publicID: 'upri2026jnon',
    OT: at('2026-05-02T08:00:00.000Z'),
    latitude_value: 7.1,
    longitude_value: 125.5,
    place: '5 km N of Davao City, Davao del Sur, Philippines',
    last_modification: at('2026-05-02T08:05:00.000Z'),
  }),
];

const commentId = (n) => `c0000000-0000-4000-8000-00000000000${n}`;
const comment = (n, fields) => ({
  commentId: commentId(n),
  eventId: oid(EVENT_ID),
  eventPublicID: 'upri2026jcom',
  accountId: null,
  username: 'Anonymous',
  status: 'approved',
  helpfulAccountIds: [],
  issueReports: [],
  __v: 0,
  ...fields,
  updatedAt: fields.createdAt,
});

// Listed newest first: C6, then C3 and C2 (same time: the higher commentId first), then C1. C4 and C5
// are hidden (pending, rejected).
const COMMENTS = [
  comment(1, { accountId: oid(AUTHOR_ID), username: 'golden_author', content: 'Strong shaking in Quezon City.', createdAt: at('2026-05-02T01:00:00.000Z') }),
  comment(2, {
    content: 'Felt it on the 5th floor.',
    imageURL: '/uploads/seeded-report.jpg',
    helpfulAccountIds: [oid(CITIZEN_ID), oid(AUTHOR_ID)],
    createdAt: at('2026-05-03T01:00:00.000Z'),
  }),
  // From before moderation, helpful marks and issue reports existed
  (({ status, helpfulAccountIds, issueReports, ...legacy }) => legacy)(
    comment(3, { content: 'Plates fell off the shelf.', createdAt: at('2026-05-03T01:00:00.000Z') }),
  ),
  comment(4, { accountId: oid(AUTHOR_ID), username: 'golden_author', content: 'Cracks on our wall.', status: 'pending', createdAt: at('2026-05-05T01:00:00.000Z') }),
  comment(5, { content: 'Buy cheap phones here.', status: 'rejected', createdAt: at('2026-05-06T01:00:00.000Z') }),
  // Its eventId no longer matches an event; it belongs to the event by publicID
  comment(6, {
    eventId: oid('69000000000000000000e3ff'),
    accountId: oid(CITIZEN_ID),
    username: 'golden_citizen',
    content: 'Windows rattled in Marikina.',
    createdAt: at('2026-05-04T01:00:00.000Z'),
  }),
];

// Every area pinned, so a developer's .env (which the app loads) can't decide where the data is read
const ALL_ON_MONGODB = {
  PEOPLE_AND_SENSORS_DB: 'mongodb', EARTHQUAKES_DB: 'mongodb', JOB_LOCKS_DB: 'mongodb', PUSH_SUBSCRIPTIONS_DB: 'mongodb', COMMUNITY_DB: 'mongodb',
};

// overrides: the area settings that differ from ALL_ON_MONGODB
const describeCommunityGolden = (overrides = {}) => {
  const settings = { ...ALL_ON_MONGODB, ...overrides };
  describeCommunityGoldenWith(settings, Object.entries(overrides).map(([key, value]) => `${key}=${value}`).join(', ') || 'all areas on MongoDB');
};

const describeCommunityGoldenWith = (settings, label) => describe(`Community: recorded API responses (${label})`, () => {
  let mongo;
  let pg;
  let app;
  let adminCookie;
  let uploadDir;

  const send = (req, agent = null) => {
    let call = (agent || request(app))[req.method.toLowerCase()](req.path);
    Object.entries(req.headers || {}).forEach(([name, value]) => { call = call.set(name, value); });
    if (req.form) {
      Object.entries(req.form).forEach(([name, value]) => { call = call.field(name, value); });
      return call.attach('image', PNG, { filename: 'report.png', contentType: 'image/png' });
    }
    return req.body === undefined ? call : call.send(req.body).set('Content-Type', 'application/json');
  };
  // A session cookie is recorded as a placeholder, not the token itself; a form's file by its name
  const recorded = (req) => {
    const { form, ...rest } = req;
    const out = form ? { ...rest, form, file: 'image: report.png (image/png)' } : rest;
    return req.headers?.Cookie ? { ...out, headers: { ...req.headers, Cookie: '<admin session cookie>' } } : out;
  };
  const check = async (name, req, { agent = null, replace } = {}) => {
    const res = await send(req, agent);
    expectGolden(name, recorded(req), res, { replace });
    return res;
  };

  // The stored points entries, sorted by dedupeKey, with ids MongoDB-style, read from where the area is
  const storedPoints = async () => {
    if (settings.COMMUNITY_DB === 'postgres') {
      const rows = await pg.db('contribution_events AS ce')
        .join('accounts AS a', 'a.id', 'ce.account_id')
        .leftJoin('events AS e', 'e.id', 'ce.event_id')
        .select('ce.*', 'a.legacy_mongo_id AS account_legacy_id', 'e.legacy_mongo_id AS event_legacy_id', 'e.public_id');
      return rows
        .map((row) => ({
          dedupeKey: row.dedupe_key,
          accountId: row.account_legacy_id.trim(),
          actionType: row.action_type,
          targetType: row.target_type,
          targetId: row.target_id,
          eventId: row.event_legacy_id ? row.event_legacy_id.trim() : null,
          eventPublicID: row.public_id || row.metadata.eventPublicID || null,
          points: row.points,
          reason: row.reason,
        }))
        .sort((a, b) => (a.dedupeKey < b.dedupeKey ? -1 : 1));
    }
    const docs = await mongoose.connection.collection('contributionevents').find().toArray();
    return docs
      .map((doc) => ({
        dedupeKey: doc.dedupeKey,
        accountId: String(doc.accountId),
        actionType: doc.actionType,
        targetType: doc.targetType,
        targetId: doc.targetId ?? null,
        eventId: doc.eventId ? String(doc.eventId) : null,
        eventPublicID: doc.eventPublicID ?? null,
        points: doc.points,
        reason: doc.reason ?? null,
      }))
      .sort((a, b) => (a.dedupeKey < b.dedupeKey ? -1 : 1));
  };
  const checkPoints = async (name, { replace } = {}) => {
    const points = await storedPoints();
    expectGolden(name, { method: 'READ', path: 'contribution points, by dedupeKey' }, { status: null, headers: {}, body: points }, { replace });
    return points;
  };
  const expectNoPoints = async () => expect(await storedPoints()).toEqual([]);

  const signIn = async (username) => {
    const agent = request.agent(app);
    const res = await send({ method: 'POST', path: '/accounts/authenticate', body: { username, password: PASSWORD, role: 'citizen' } }, agent);
    if (res.status !== 200) throw new Error(`Sign-in for ${username} failed: ${res.status}`);
    return agent;
  };
  const citizen = () => signIn('golden_citizen');
  const author = () => signIn('golden_author');
  const asAdmin = (req) => ({ ...req, headers: { ...(req.headers || {}), Cookie: adminCookie } });
  const list = (query) => ({ method: 'GET', path: `/comments?${query}` });

  beforeAll(async () => {
    [mongo, pg] = await Promise.all([startMongo(), startPostgres()]);
    uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ehub-golden-uploads-'));
    // Before the app loads: repositories pick their database, and the routes read these on load
    Object.assign(process.env, pg.env, settings, {
      UPLOAD_DIR: uploadDir,
      UPLOAD_PUBLIC_PATH: '/uploads',
      COMMENTS_DEFAULT_STATUS: 'approved',
      REPORT_POST_RATE_LIMIT_MAX: '1000', // every anonymous post here comes from one address
    });
    app = require('../../src/app');
    const { generateAccessToken } = require('../../src/controllers/helpers');
    adminCookie = `accessToken=${generateAccessToken(ADMIN, 'web')}`;
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  }, Math.max(MONGO_STARTUP_TIMEOUT_MS, PG_STARTUP_TIMEOUT_MS));

  beforeEach(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'trace').mockImplementation(() => {});
    await Promise.all([mongo.clear(), pg.clear()]);
    await mongoose.connection.collection('accounts').insertMany(ACCOUNTS);
    await mongoose.connection.collection('events').insertMany(EVENTS);
    await mongoose.connection.collection('comments').insertMany(COMMENTS);
    // Each area on PostgreSQL: copied with its real copy script, then removed from MongoDB
    const quiet = { db: pg.db, log: () => {} };
    const moved = [];
    if (settings.PEOPLE_AND_SENSORS_DB === 'postgres') {
      if (!(await copyPeopleAndSensors(quiet)).ok) throw new Error('Copying the seeded accounts to PostgreSQL failed');
      moved.push('accounts');
    }
    if (settings.EARTHQUAKES_DB === 'postgres') {
      if (!(await copyEarthquakes(quiet)).ok) throw new Error('Copying the seeded events to PostgreSQL failed');
      moved.push('events');
    }
    if (settings.COMMUNITY_DB === 'postgres') {
      const copied = await copyCommunity(quiet);
      if (!copied.ok || copied.comments.skipped.length > 0) throw new Error('Copying the seeded comments to PostgreSQL failed');
      moved.push('comments', 'contributionevents');
    }
    await Promise.all(moved.map((name) => mongoose.connection.collection(name).deleteMany({})));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await require('../../src/db/knex').db.destroy();
    await Promise.all([mongo && mongo.stop(), pg && pg.stop()]);
    if (uploadDir) fs.rmSync(uploadDir, { recursive: true, force: true });
  });

  describe('POST /comments', () => {
    const post = (body) => ({ method: 'POST', path: '/comments', body: { eventId: EVENT_ID, ...body } });
    const newComment = (res) => ({ [res.body.payload.commentId]: '<new comment id>' });

    test('anonymous (signed out): no points', async () => {
      const req = post({ content: '  Light shaking here.  ' });
      const res = await send(req);
      expectGolden('comments.create.anonymous', recorded(req), res, { replace: newComment(res) });
      await expectNoPoints();
    });
    test('signed in, posted under the username', async () => {
      const req = post({ content: 'Felt a strong jolt.', anonymous: false });
      const res = await send(req, await citizen());
      expectGolden('comments.create.signed-in', recorded(req), res, { replace: newComment(res) });
      await checkPoints('comments.create.signed-in.points', { replace: newComment(res) });
    });
    test('signed in but posted anonymously (the default): still earns points', async () => {
      const req = post({ content: 'Doors swung open.' });
      const res = await send(req, await citizen());
      expectGolden('comments.create.signed-in-anonymous', recorded(req), res, { replace: newComment(res) });
      await checkPoints('comments.create.signed-in-anonymous.points', { replace: newComment(res) });
    });
    test('image only, signed in: points for the report and the image', async () => {
      const req = { method: 'POST', path: '/comments', form: { eventId: EVENT_ID, anonymous: 'false' } };
      const res = await send(req, await citizen());
      expectGolden('comments.create.image-only', recorded(req), res, {
        replace: { ...newComment(res), [res.body.payload.imageURL]: '<uploaded image URL>' },
      });
      await checkPoints('comments.create.image-only.points', { replace: newComment(res) });
    });
    test('an unknown event', async () => {
      await check('comments.create.unknown-event', post({ eventId: UNKNOWN_EVENT_ID, content: 'Anyone else?' }), { agent: await citizen() });
      await expectNoPoints();
    });
    test('no content and no image', async () => {
      await check('comments.create.no-content', post({ content: '   ' }), { agent: await citizen() });
      await expectNoPoints();
    });
    test('an eventId that is not an ObjectId', () => check('comments.create.invalid-event-id', post({ eventId: 'upri2026jcom', content: 'Hello.' })));
  });

  describe('GET /comments', () => {
    test('first page, as a signed-in citizen (who marked one helpful)', async () => {
      await check('comments.list.first-page', list(`eventId=${EVENT_ID}&limit=3`), { agent: await citizen() });
    });
    test('next page by cursor (signed out)', async () => {
      const first = await send(list(`eventId=${EVENT_ID}&limit=3`));
      await check('comments.list.next-page', list(`eventId=${EVENT_ID}&limit=3&cursor=${first.body.pagination.nextCursor}`));
    });
    test('by offset', () => check('comments.list.offset', list(`eventId=${EVENT_ID}&limit=1&offset=2`)));
    test('an event with no comments', () => check('comments.list.empty', list(`eventId=${QUIET_EVENT_ID}`)));
    test('an unknown event', () => check('comments.list.unknown-event', list(`eventId=${UNKNOWN_EVENT_ID}`)));
    test('a malformed cursor', () => check('comments.list.invalid-cursor', list(`eventId=${EVENT_ID}&cursor=not-a-cursor`)));
    test('a limit over 100', () => check('comments.list.invalid-limit', list(`eventId=${EVENT_ID}&limit=101`)));
  });

  describe('PUT / DELETE /comments/:commentId/helpful', () => {
    const mark = (n) => ({ method: 'PUT', path: `/comments/${commentId(n)}/helpful` });
    const unmark = (n) => ({ method: 'DELETE', path: `/comments/${commentId(n)}/helpful` });

    test('mark, mark again, unmark, then mark again: points once', async () => {
      const agent = await citizen();
      await check('comments.helpful.mark', mark(1), { agent });
      const points = await checkPoints('comments.helpful.mark.points');
      await check('comments.helpful.mark-again', mark(1), { agent });
      expect(await storedPoints()).toEqual(points);
      await check('comments.helpful.unmark', unmark(1), { agent });
      expect(await storedPoints()).toEqual(points);
      await check('comments.helpful.mark-after-unmark', mark(1), { agent });
      expect(await storedPoints()).toEqual(points);
    });
    test('an anonymous report (from before helpful marks existed): points for the voter only', async () => {
      await check('comments.helpful.mark.anonymous-report', mark(3), { agent: await author() });
      await checkPoints('comments.helpful.mark.anonymous-report.points');
    });
    test('your own report: no points', async () => {
      await check('comments.helpful.mark.own-report', mark(6), { agent: await citizen() });
      await expectNoPoints();
    });
    test('signed out', async () => {
      await check('comments.helpful.mark.signed-out', mark(1));
      await check('comments.helpful.unmark.signed-out', unmark(2));
      await expectNoPoints();
    });
    test('an unknown or hidden comment', async () => {
      const agent = await citizen();
      await check('comments.helpful.mark.not-found', { method: 'PUT', path: '/comments/no-such-comment/helpful' }, { agent });
      await check('comments.helpful.unmark.not-found', { method: 'DELETE', path: '/comments/no-such-comment/helpful' }, { agent });
      await check('comments.helpful.mark.hidden', mark(4), { agent });
      await expectNoPoints();
    });
  });

  describe('POST /comments/:commentId/issues', () => {
    const report = (n, reason) => ({ method: 'POST', path: `/comments/${n === null ? 'no-such-comment' : commentId(n)}/issues`, body: { reason } });

    test('a report, then a second one by the same account: one points entry, with the first reason', async () => {
      const agent = await citizen();
      await check('comments.issue.report', report(1, 'unclear'), { agent });
      const points = await checkPoints('comments.issue.report.points');
      await check('comments.issue.report-again', report(1, 'duplicate'), { agent });
      expect(await storedPoints()).toEqual(points);
    });
    test('an invalid reason', async () => {
      await check('comments.issue.invalid-reason', report(1, 'downvote'), { agent: await citizen() });
      await expectNoPoints();
    });
    test('an unknown comment', async () => {
      await check('comments.issue.not-found', report(null, 'unclear'), { agent: await citizen() });
      await expectNoPoints();
    });
    test('signed out', async () => {
      await check('comments.issue.signed-out', report(1, 'unclear'));
      await expectNoPoints();
    });
  });

  describe('PATCH /comments/:commentId/status (admin)', () => {
    const patch = (id, status) => ({ method: 'PATCH', path: `/comments/${id}/status`, body: { status } });

    test('as an admin: approve a pending report (eventId and accountId stay MongoDB ids), then list', async () => {
      await check('comments.status.admin', asAdmin(patch(commentId(4), 'approved')));
      await check('comments.status.admin.then-list', list(`eventId=${EVENT_ID}`));
      await expectNoPoints();
    });
    test('as a citizen', async () => check('comments.status.wrong-role', patch(commentId(1), 'rejected'), { agent: await citizen() }));
    test('signed out', () => check('comments.status.signed-out', patch(commentId(1), 'rejected')));
    test('an unknown comment', () => check('comments.status.not-found', asAdmin(patch('no-such-comment', 'rejected'))));
    test('an invalid status', () => check('comments.status.invalid', asAdmin(patch(commentId(1), 'hidden'))));
  });

  describe('DELETE /comments/:commentId (admin)', () => {
    const del = (id) => ({ method: 'DELETE', path: `/comments/${id}` });

    test('as an admin, then list', async () => {
      await check('comments.delete.admin', asAdmin(del(commentId(1))));
      await check('comments.delete.admin.then-list', list(`eventId=${EVENT_ID}`));
      await expectNoPoints();
    });
    test('as a citizen', async () => check('comments.delete.wrong-role', del(commentId(1)), { agent: await citizen() }));
    test('an unknown comment', () => check('comments.delete.not-found', asAdmin(del('no-such-comment'))));
  });
});

module.exports = { describeCommunityGolden };
