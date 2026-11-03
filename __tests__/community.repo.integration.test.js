// Behavior both versions of the comments and contributions repositories must have, run against MongoDB
// and PostgreSQL alike, so switching community to PostgreSQL can't change what services see.
const mongoose = require('mongoose');
const mongoCommentsRepo = require('../src/repositories/mongodb/comments.repo');
const mongoContributionsRepo = require('../src/repositories/mongodb/contributions.repo');
const mongoTransactions = require('../src/repositories/mongodb/transactions');
const { createCommentsRepo } = require('../src/repositories/postgres/comments.repo');
const { createContributionsRepo } = require('../src/repositories/postgres/contributions.repo');
const { createPostgresTransactions } = require('../src/repositories/postgres/transactions');
const { copyCommunity } = require('../scripts/copy-community-to-postgres');
const { startMongo, MONGO_STARTUP_TIMEOUT_MS } = require('./fixtures/mongo.fixture');
const { startPostgres, PG_STARTUP_TIMEOUT_MS } = require('./fixtures/postgres.fixture');

const at = (iso) => new Date(iso);
const EVENT = { _id: '69000000000000000000e201', publicID: 'upri2026jcom' };
const OTHER_EVENT = { _id: '69000000000000000000e202', publicID: 'upri2026jzzz' };
const AUTHOR = '69000000000000000000a201';
const VOTER = '69000000000000000000a202';
const OTHER_VOTER = '69000000000000000000a203';

// commentIds: UUIDs, as the app generates them (their order breaks ties in listings)
const ID = Object.fromEntries(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'visible', 'pending', 'report', 'unknown']
  .map((name, i) => [name, `c0000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`]));

// A comment as an earlier version of the app stored it
const seeded = (commentId, fields = {}) => ({
  commentId,
  eventId: EVENT._id,
  eventPublicID: EVENT.publicID,
  accountId: null,
  username: 'Anonymous',
  content: `Report ${commentId}.`,
  status: 'approved',
  helpfulAccountIds: [],
  issueReports: [],
  createdAt: at('2026-05-02T00:00:00.000Z'),
  updatedAt: at('2026-05-02T00:00:00.000Z'),
  ...fields,
});

// Stored in MongoDB as-is, without the model's defaults (status: undefined leaves it out, as on records
// from before moderation)
const insertIntoMongo = (docs) => {
  const toObjectId = (id) => (id ? new mongoose.Types.ObjectId(id) : id);
  return mongoose.connection.collection('comments').insertMany(docs.map((doc) => {
    const stored = {
      ...doc,
      eventId: toObjectId(doc.eventId),
      accountId: toObjectId(doc.accountId),
      helpfulAccountIds: (doc.helpfulAccountIds || []).map(toObjectId),
      issueReports: (doc.issueReports || []).map((report) => ({ ...report, accountId: toObjectId(report.accountId) })),
    };
    Object.keys(stored).forEach((key) => stored[key] === undefined && delete stored[key]);
    return stored;
  }));
};

// Each backend: the repositories, its transactions, and helpers to store or count records directly
const backends = [
  {
    name: 'mongodb',
    timeout: MONGO_STARTUP_TIMEOUT_MS,
    start: async () => {
      const mongo = await startMongo();
      return {
        Comments: mongoCommentsRepo,
        Contributions: mongoContributionsRepo,
        withTransaction: mongoTransactions.withTransaction,
        insertComments: insertIntoMongo,
        countContributions: () => mongoose.connection.collection('contributionevents').countDocuments(),
        clear: mongo.clear,
        stop: mongo.stop,
      };
    },
  },
  {
    name: 'postgres',
    timeout: Math.max(MONGO_STARTUP_TIMEOUT_MS, PG_STARTUP_TIMEOUT_MS),
    start: async () => {
      // MongoDB too: an older comment arrives in PostgreSQL the way it really would, through the copy script
      const [mongo, pg] = await Promise.all([startMongo(), startPostgres()]);
      // The accounts and events (copied in Steps 2 and 3) these tests name by their MongoDB ids
      const seed = async () => {
        await pg.db('accounts').insert([AUTHOR, VOTER, OTHER_VOTER].map((legacyId, i) => ({
          legacy_mongo_id: legacyId, username: `account${i}`, email: `account${i}@example.org`, password_hash: 'x', roles: pg.db.raw("'{citizen}'"),
        })));
        await pg.db('events').insert([EVENT, OTHER_EVENT].map(({ _id, publicID }) => ({
          legacy_mongo_id: _id, public_id: publicID, origin_time: at('2026-05-01T08:00:00.000Z'), latitude: 14.6, longitude: 121,
        })));
      };
      await seed();
      return {
        Comments: createCommentsRepo(pg.db),
        Contributions: createContributionsRepo(pg.db),
        withTransaction: createPostgresTransactions(pg.db).withTransaction,
        insertComments: async (docs) => {
          await insertIntoMongo(docs);
          const copied = await copyCommunity({ db: pg.db, log: () => {} });
          if (!copied.ok || copied.comments.skipped.length > 0) throw new Error('Copying the comments to PostgreSQL failed');
        },
        countContributions: async () => Number((await pg.db('contribution_events').count({ n: '*' }).first()).n),
        pg,
        clear: async () => {
          await Promise.all([mongo.clear(), pg.clear()]);
          await seed();
        },
        stop: async () => {
          await Promise.all([mongo.stop(), pg.stop()]);
        },
      };
    },
  },
];

describe.each(backends)('community repositories ($name)', ({ start, timeout }) => {
  let backend;
  let Comments;
  let Contributions;

  beforeAll(async () => {
    backend = await start();
    ({ Comments, Contributions } = backend);
  }, timeout);

  afterEach(() => backend.clear());
  afterAll(() => backend && backend.stop());

  describe('create', () => {
    test('stores a signed-in report with a new commentId and returns it with empty lists', async () => {
      const comment = await Comments.create({
        eventId: EVENT._id,
        eventPublicID: EVENT.publicID,
        accountId: AUTHOR,
        username: 'golden_author',
        content: 'Felt strong shaking.',
        imageURL: '/uploads/report.png',
        status: 'approved',
      });

      expect(comment).toEqual({
        commentId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        eventId: EVENT._id,
        eventPublicID: EVENT.publicID,
        accountId: AUTHOR,
        username: 'golden_author',
        content: 'Felt strong shaking.',
        imageURL: '/uploads/report.png',
        status: 'approved',
        helpfulAccountIds: [],
        issueReports: [],
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });
      expect(await Comments.findVisible(comment.commentId)).toEqual(comment);
    });

    test('an anonymous image-only report has accountId null and no content', async () => {
      const comment = await Comments.create({
        eventId: EVENT._id, eventPublicID: EVENT.publicID, accountId: null, username: 'Anonymous', imageURL: '/uploads/only.png', status: 'pending',
      });

      expect(comment).toEqual(expect.objectContaining({ accountId: null, username: 'Anonymous', imageURL: '/uploads/only.png', status: 'pending' }));
      expect(comment).not.toHaveProperty('content');
    });

    test('rejects a report with neither text nor an image, or text over 1000 characters', async () => {
      const base = { eventId: EVENT._id, eventPublicID: EVENT.publicID, accountId: null, username: 'Anonymous', status: 'approved' };

      await expect(Comments.create(base)).rejects.toThrow();
      await expect(Comments.create({ ...base, content: 'x'.repeat(1001) })).rejects.toMatchObject({ name: 'ValidationError' });
      await expect(Comments.create({ ...base, content: 'x'.repeat(1000) })).resolves.toEqual(expect.objectContaining({ content: 'x'.repeat(1000) }));
    });
  });

  describe('listVisibleForEvent', () => {
    // Newest first: c6, then c3 and c2 (same time, higher commentId first), then c1. Not listed: c4 and
    // c5 (pending, rejected) and the other event's comment
    beforeEach(() => backend.insertComments([
      seeded(ID.c1, { createdAt: at('2026-05-02T00:00:00.000Z'), accountId: AUTHOR, username: 'golden_author', helpfulAccountIds: [VOTER] }),
      seeded(ID.c2, { createdAt: at('2026-05-03T00:00:00.000Z'), content: undefined, imageURL: '/uploads/c2.png' }),
      seeded(ID.c3, { createdAt: at('2026-05-03T00:00:00.000Z'), status: undefined }),
      seeded(ID.c4, { createdAt: at('2026-05-05T00:00:00.000Z'), status: 'pending' }),
      seeded(ID.c5, { createdAt: at('2026-05-06T00:00:00.000Z'), status: 'rejected' }),
      // Its eventId no longer matches; it belongs to the event by publicID
      seeded(ID.c6, { createdAt: at('2026-05-04T00:00:00.000Z'), eventId: '69000000000000000000e2ff' }),
      seeded(ID.c7, { createdAt: at('2026-05-07T00:00:00.000Z'), eventId: OTHER_EVENT._id, eventPublicID: OTHER_EVENT.publicID }),
    ]));

    const ids = (page) => page.comments.map((comment) => comment.commentId);

    test('gives visible comments only, newest first, matched by eventId or eventPublicID', async () => {
      const page = await Comments.listVisibleForEvent(EVENT, { limit: 10 });

      expect(ids(page)).toEqual([ID.c6, ID.c3, ID.c2, ID.c1]);
      expect(page).toEqual(expect.objectContaining({ hasMore: false, total: 4 }));
      expect(page.comments[3]).toEqual(expect.objectContaining({ accountId: AUTHOR, helpfulAccountIds: [VOTER], issueReports: [] }));
      expect(page.comments[2]).not.toHaveProperty('content');
      // From before moderation: no status in MongoDB, approved once copied; shown either way
      expect([undefined, 'approved']).toContain(page.comments[1].status);
    });

    test('pages by limit and offset; hasMore says whether more follow', async () => {
      expect(await Comments.listVisibleForEvent(EVENT, { limit: 2 })).toEqual(expect.objectContaining({ hasMore: true, total: 4 }));
      const second = await Comments.listVisibleForEvent(EVENT, { limit: 2, offset: 2 });

      expect(ids(second)).toEqual([ID.c2, ID.c1]);
      expect(second).toEqual(expect.objectContaining({ hasMore: false, total: 4 }));
      expect(await Comments.listVisibleForEvent(EVENT, { limit: 2, offset: 10 })).toEqual({ comments: [], hasMore: false, total: 4 });
    });

    test('`after` continues from a cursor, ties broken by commentId; total counts from the cursor on', async () => {
      const page = await Comments.listVisibleForEvent(EVENT, { limit: 1, after: { createdAt: at('2026-05-03T00:00:00.000Z'), commentId: ID.c3 } });

      expect(ids(page)).toEqual([ID.c2]);
      expect(page).toEqual(expect.objectContaining({ hasMore: true, total: 2 }));
    });

    test('an event with no comments', async () => {
      expect(await Comments.listVisibleForEvent({ _id: '69000000000000000000e203', publicID: 'upri2026jnon' }, { limit: 5 }))
        .toEqual({ comments: [], hasMore: false, total: 0 });
    });
  });

  describe('find, moderate, delete', () => {
    beforeEach(() => backend.insertComments([
      seeded(ID.visible, { accountId: AUTHOR, username: 'golden_author' }),
      seeded(ID.pending, { status: 'pending' }),
    ]));

    test('findVisible gives a visible comment, or null for a hidden, unknown or malformed one', async () => {
      expect(await Comments.findVisible(ID.visible)).toEqual(expect.objectContaining({
        commentId: ID.visible, eventId: EVENT._id, eventPublicID: EVENT.publicID, accountId: AUTHOR,
      }));
      expect(await Comments.findVisible(ID.pending)).toBeNull();
      expect(await Comments.findVisible(ID.unknown)).toBeNull();
      expect(await Comments.findVisible('no-such-comment')).toBeNull();
    });

    test('setStatus stores the status, moderator and time on any comment; null when unknown', async () => {
      const moderatedAt = at('2026-05-10T00:00:00.000Z');
      const approved = await Comments.setStatus(ID.pending, { status: 'approved', moderatedBy: 'golden_admin', moderatedAt });

      expect(approved).toEqual(expect.objectContaining({ commentId: ID.pending, status: 'approved', moderatedBy: 'golden_admin', moderatedAt }));
      expect(approved.updatedAt.getTime()).toBeGreaterThan(at('2026-05-02T00:00:00.000Z').getTime());
      expect(await Comments.findVisible(ID.pending)).toEqual(approved);
      expect(await Comments.setStatus(ID.visible, { status: 'rejected', moderatedBy: 'golden_admin', moderatedAt })).toEqual(expect.objectContaining({ status: 'rejected' }));
      expect(await Comments.findVisible(ID.visible)).toBeNull();
      expect(await Comments.setStatus(ID.unknown, { status: 'approved', moderatedBy: 'golden_admin', moderatedAt })).toBeNull();
      expect(await Comments.setStatus('no-such-comment', { status: 'approved', moderatedBy: 'golden_admin', moderatedAt })).toBeNull();
    });

    test('remove deletes any comment and gives it back; null when unknown', async () => {
      expect(await Comments.remove(ID.pending)).toEqual(expect.objectContaining({ commentId: ID.pending, status: 'pending' }));
      expect(await Comments.remove(ID.pending)).toBeNull();
      expect(await Comments.remove('no-such-comment')).toBeNull();
      expect(await Comments.listVisibleForEvent(EVENT, { limit: 5 })).toEqual(expect.objectContaining({ total: 1 }));
    });
  });

  describe('helpful marks', () => {
    beforeEach(() => backend.insertComments([seeded(ID.report), seeded(ID.pending, { status: 'pending' })]));

    test('an account marks a comment once: a second mark changes nothing', async () => {
      const first = await Comments.addHelpfulMark(ID.report, VOTER);
      expect(first).toEqual({ comment: expect.objectContaining({ commentId: ID.report, helpfulAccountIds: [VOTER] }), added: true });
      expect(first.comment.updatedAt.getTime()).toBeGreaterThan(at('2026-05-02T00:00:00.000Z').getTime());

      const again = await Comments.addHelpfulMark(ID.report, VOTER);
      expect(again).toEqual({ comment: expect.objectContaining({ helpfulAccountIds: [VOTER] }), added: false });
      expect(again.comment.updatedAt).toEqual(first.comment.updatedAt);

      const other = await Comments.addHelpfulMark(ID.report, OTHER_VOTER);
      expect(other.comment.helpfulAccountIds).toEqual([VOTER, OTHER_VOTER]);
    });

    test('removeHelpfulMark removes only that account\'s mark; a comment without one is unchanged', async () => {
      await Comments.addHelpfulMark(ID.report, VOTER);
      await Comments.addHelpfulMark(ID.report, OTHER_VOTER);

      expect((await Comments.removeHelpfulMark(ID.report, VOTER)).helpfulAccountIds).toEqual([OTHER_VOTER]);
      expect((await Comments.removeHelpfulMark(ID.report, VOTER)).helpfulAccountIds).toEqual([OTHER_VOTER]);
    });

    test('null for a hidden, unknown or malformed comment', async () => {
      expect(await Comments.addHelpfulMark(ID.pending, VOTER)).toBeNull();
      expect(await Comments.addHelpfulMark(ID.unknown, VOTER)).toBeNull();
      expect(await Comments.addHelpfulMark('no-such-comment', VOTER)).toBeNull();
      expect(await Comments.removeHelpfulMark(ID.pending, VOTER)).toBeNull();
      expect(await Comments.removeHelpfulMark(ID.unknown, VOTER)).toBeNull();
    });
  });

  describe('issue reports', () => {
    beforeEach(() => backend.insertComments([seeded(ID.report), seeded(ID.pending, { status: 'pending' })]));

    test('one report per account: a second one replaces the reason and time', async () => {
      const first = await Comments.saveIssueReport(ID.report, { accountId: VOTER, reason: 'unclear', createdAt: at('2026-05-10T00:00:00.000Z') });
      expect(first.issueReports).toEqual([{ accountId: VOTER, reason: 'unclear', createdAt: at('2026-05-10T00:00:00.000Z') }]);

      const second = await Comments.saveIssueReport(ID.report, { accountId: VOTER, reason: 'duplicate', createdAt: at('2026-05-11T00:00:00.000Z') });
      expect(second.issueReports).toEqual([{ accountId: VOTER, reason: 'duplicate', createdAt: at('2026-05-11T00:00:00.000Z') }]);

      const other = await Comments.saveIssueReport(ID.report, { accountId: OTHER_VOTER, reason: 'not_related', createdAt: at('2026-05-12T00:00:00.000Z') });
      expect(other.issueReports.map(({ accountId, reason }) => [accountId, reason])).toEqual([[VOTER, 'duplicate'], [OTHER_VOTER, 'not_related']]);
    });

    test('reports at the same time by one account still leave one', async () => {
      await Promise.all(['unclear', 'duplicate', 'inappropriate'].map((reason) => (
        Comments.saveIssueReport(ID.report, { accountId: VOTER, reason, createdAt: at('2026-05-10T00:00:00.000Z') }))));

      expect((await Comments.findVisible(ID.report)).issueReports).toHaveLength(1);
    });

    test('null for a hidden or unknown comment', async () => {
      const report = { accountId: VOTER, reason: 'unclear', createdAt: at('2026-05-10T00:00:00.000Z') };
      expect(await Comments.saveIssueReport(ID.pending, report)).toBeNull();
      expect(await Comments.saveIssueReport(ID.unknown, report)).toBeNull();
    });
  });

  describe('contribution points', () => {
    const entry = (fields = {}) => ({
      dedupeKey: `${VOTER}:report_marked_helpful:comment:${ID.report}`,
      accountId: VOTER,
      actionType: 'report_marked_helpful',
      targetType: 'comment',
      targetId: ID.report,
      eventId: EVENT._id,
      eventPublicID: EVENT.publicID,
      points: 1,
      ...fields,
    });

    test('recordOnce stores an entry and gives it back', async () => {
      expect(await Contributions.recordOnce(entry())).toEqual({
        ...entry(),
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });
    });

    test('the same dedupeKey never counts twice: the first entry is kept and returned', async () => {
      const first = await Contributions.recordOnce(entry({ reason: 'first' }));
      const again = await Contributions.recordOnce(entry({ reason: 'second', points: 5 }));

      expect(again).toEqual(first);
      expect(await backend.countContributions()).toBe(1);
    });

    test('at the same time, still once', async () => {
      await Promise.all([1, 2, 3].map(() => Contributions.recordOnce(entry())));

      expect(await backend.countContributions()).toBe(1);
    });

    test('optional fields are left out when not set', async () => {
      const stored = await Contributions.recordOnce(entry({ dedupeKey: 'global', targetId: undefined, eventId: undefined, eventPublicID: undefined }));

      expect(stored).not.toHaveProperty('targetId');
      expect(stored).not.toHaveProperty('eventId');
      expect(stored).not.toHaveProperty('eventPublicID');
      expect(stored).not.toHaveProperty('reason');
    });
  });

  describe('transactions: a comment write and its points together', () => {
    beforeEach(() => backend.insertComments([seeded(ID.report, { accountId: AUTHOR, username: 'golden_author' })]));

    const points = (fields = {}) => ({
      dedupeKey: `${VOTER}:report_marked_helpful:comment:${ID.report}`,
      accountId: VOTER,
      actionType: 'report_marked_helpful',
      targetType: 'comment',
      targetId: ID.report,
      eventId: EVENT._id,
      eventPublicID: EVENT.publicID,
      points: 1,
      ...fields,
    });

    test('a helpful mark and its points are written together', async () => {
      await backend.withTransaction(async (tx) => {
        await Comments.addHelpfulMark(ID.report, VOTER, { tx });
        await Contributions.recordOnce(points(), { tx });
        await Contributions.recordOnce(points({ dedupeKey: 'author', accountId: AUTHOR, actionType: 'report_received_helpful', points: 2 }), { tx });
      });

      expect((await Comments.findVisible(ID.report)).helpfulAccountIds).toEqual([VOTER]);
      expect(await backend.countContributions()).toBe(2);
    });

    test('a failed step inside a helpful mark rolls back the mark and its points', async () => {
      await expect(backend.withTransaction(async (tx) => {
        await Comments.addHelpfulMark(ID.report, VOTER, { tx });
        await Contributions.recordOnce(points(), { tx });
        throw new Error('author points write failed');
      })).rejects.toThrow('author points write failed');

      const comment = await Comments.findVisible(ID.report);
      expect(comment.helpfulAccountIds).toEqual([]);
      expect(comment.updatedAt).toEqual(at('2026-05-02T00:00:00.000Z'));
      expect(await backend.countContributions()).toBe(0);
    });

    test('a failed step inside an issue report rolls back the report and its points', async () => {
      await expect(backend.withTransaction(async (tx) => {
        await Comments.saveIssueReport(ID.report, { accountId: VOTER, reason: 'unclear', createdAt: at('2026-05-10T00:00:00.000Z') }, { tx });
        await Contributions.recordOnce(points({ dedupeKey: 'issue', actionType: 'report_issue_submitted', points: 0, reason: 'unclear' }), { tx });
        throw new Error('later step failed');
      })).rejects.toThrow('later step failed');

      expect((await Comments.findVisible(ID.report)).issueReports).toEqual([]);
      expect(await backend.countContributions()).toBe(0);
    });

    test('a failed step inside posting a report rolls back the report and its points', async () => {
      await expect(backend.withTransaction(async (tx) => {
        const comment = await Comments.create({
          eventId: EVENT._id, eventPublicID: EVENT.publicID, accountId: VOTER, username: 'voter', content: 'Felt it.', status: 'approved',
        }, { tx });
        await Contributions.recordOnce(points({ dedupeKey: 'posted', actionType: 'report_posted', targetId: comment.commentId, points: 5 }), { tx });
        throw new Error('image points write failed');
      })).rejects.toThrow('image points write failed');

      expect((await Comments.listVisibleForEvent(EVENT, { limit: 5 })).total).toBe(1);
      expect(await backend.countContributions()).toBe(0);
    });
  });
});
