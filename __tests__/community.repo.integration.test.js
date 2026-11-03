// Behavior the comments and contributions repositories must have. Runs against MongoDB now; Step 4 -
// Ticket 3 adds the PostgreSQL versions to `backends`, so the same cases guard the switch.
const mongoose = require('mongoose');
const mongoCommentsRepo = require('../src/repositories/mongodb/comments.repo');
const mongoContributionsRepo = require('../src/repositories/mongodb/contributions.repo');
const { startMongo, MONGO_STARTUP_TIMEOUT_MS } = require('./fixtures/mongo.fixture');

const at = (iso) => new Date(iso);
const EVENT = { _id: '69000000000000000000e201', publicID: 'upri2026jcom' };
const OTHER_EVENT = { _id: '69000000000000000000e202', publicID: 'upri2026jzzz' };
const AUTHOR = '69000000000000000000a201';
const VOTER = '69000000000000000000a202';
const OTHER_VOTER = '69000000000000000000a203';

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

// Each backend: the repositories, and helpers to store or look at records directly
const backends = [
  {
    name: 'mongodb',
    timeout: MONGO_STARTUP_TIMEOUT_MS,
    start: async () => {
      const mongo = await startMongo();
      const comments = () => mongoose.connection.collection('comments');
      const toObjectId = (id) => (id ? new mongoose.Types.ObjectId(id) : id);
      return {
        Comments: mongoCommentsRepo,
        Contributions: mongoContributionsRepo,
        // Stored as-is, without the model's defaults (status: undefined leaves it out, as on records
        // from before moderation)
        insertComments: (docs) => comments().insertMany(docs.map((doc) => {
          const stored = {
            ...doc,
            eventId: toObjectId(doc.eventId),
            accountId: toObjectId(doc.accountId),
            helpfulAccountIds: doc.helpfulAccountIds.map(toObjectId),
            issueReports: doc.issueReports.map((report) => ({ ...report, accountId: toObjectId(report.accountId) })),
          };
          Object.keys(stored).forEach((key) => stored[key] === undefined && delete stored[key]);
          return stored;
        })),
        countContributions: () => mongoose.connection.collection('contributionevents').countDocuments(),
        clear: mongo.clear,
        stop: mongo.stop,
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
    // Newest first: c6, then c2 and c3 (same time, higher commentId first), then c1. Not listed: c4 and
    // c5 (pending, rejected) and the other event's comment
    beforeEach(() => backend.insertComments([
      seeded('c1', { createdAt: at('2026-05-02T00:00:00.000Z'), accountId: AUTHOR, username: 'golden_author', helpfulAccountIds: [VOTER] }),
      seeded('c2', { createdAt: at('2026-05-03T00:00:00.000Z'), content: undefined, imageURL: '/uploads/c2.png' }),
      seeded('c3', { createdAt: at('2026-05-03T00:00:00.000Z'), status: undefined }),
      seeded('c4', { createdAt: at('2026-05-05T00:00:00.000Z'), status: 'pending' }),
      seeded('c5', { createdAt: at('2026-05-06T00:00:00.000Z'), status: 'rejected' }),
      // Its eventId no longer matches; it belongs to the event by publicID
      seeded('c6', { createdAt: at('2026-05-04T00:00:00.000Z'), eventId: '69000000000000000000e2ff' }),
      seeded('c7', { createdAt: at('2026-05-07T00:00:00.000Z'), eventId: OTHER_EVENT._id, eventPublicID: OTHER_EVENT.publicID }),
    ]));

    const ids = (page) => page.comments.map((comment) => comment.commentId);

    test('gives visible comments only, newest first, matched by eventId or eventPublicID', async () => {
      const page = await Comments.listVisibleForEvent(EVENT, { limit: 10 });

      expect(ids(page)).toEqual(['c6', 'c3', 'c2', 'c1']);
      expect(page).toEqual(expect.objectContaining({ hasMore: false, total: 4 }));
      expect(page.comments[3]).toEqual(expect.objectContaining({ accountId: AUTHOR, helpfulAccountIds: [VOTER], issueReports: [] }));
      expect(page.comments[2]).not.toHaveProperty('content');
      expect(page.comments[1]).not.toHaveProperty('status');
    });

    test('pages by limit and offset; hasMore says whether more follow', async () => {
      expect(await Comments.listVisibleForEvent(EVENT, { limit: 2 })).toEqual(expect.objectContaining({ hasMore: true, total: 4 }));
      const second = await Comments.listVisibleForEvent(EVENT, { limit: 2, offset: 2 });

      expect(ids(second)).toEqual(['c2', 'c1']);
      expect(second).toEqual(expect.objectContaining({ hasMore: false, total: 4 }));
    });

    test('`after` continues from a cursor, ties broken by commentId; total counts from the cursor on', async () => {
      const page = await Comments.listVisibleForEvent(EVENT, { limit: 1, after: { createdAt: at('2026-05-03T00:00:00.000Z'), commentId: 'c3' } });

      expect(ids(page)).toEqual(['c2']);
      expect(page).toEqual(expect.objectContaining({ hasMore: true, total: 2 }));
    });

    test('an event with no comments', async () => {
      expect(await Comments.listVisibleForEvent({ _id: '69000000000000000000e203', publicID: 'upri2026jnon' }, { limit: 5 }))
        .toEqual({ comments: [], hasMore: false, total: 0 });
    });
  });

  describe('find, moderate, delete', () => {
    beforeEach(() => backend.insertComments([
      seeded('visible', { accountId: AUTHOR, username: 'golden_author' }),
      seeded('pending', { status: 'pending' }),
    ]));

    test('findVisible gives a visible comment, or null for a hidden or unknown one', async () => {
      expect(await Comments.findVisible('visible')).toEqual(expect.objectContaining({ commentId: 'visible', eventId: EVENT._id, eventPublicID: EVENT.publicID, accountId: AUTHOR }));
      expect(await Comments.findVisible('pending')).toBeNull();
      expect(await Comments.findVisible('unknown')).toBeNull();
    });

    test('setStatus stores the status, moderator and time on any comment; null when unknown', async () => {
      const moderatedAt = at('2026-05-10T00:00:00.000Z');
      const approved = await Comments.setStatus('pending', { status: 'approved', moderatedBy: 'golden_admin', moderatedAt });

      expect(approved).toEqual(expect.objectContaining({ commentId: 'pending', status: 'approved', moderatedBy: 'golden_admin', moderatedAt }));
      expect(approved.updatedAt.getTime()).toBeGreaterThan(at('2026-05-02T00:00:00.000Z').getTime());
      expect(await Comments.findVisible('pending')).toEqual(approved);
      expect(await Comments.setStatus('visible', { status: 'rejected', moderatedBy: 'golden_admin', moderatedAt })).toEqual(expect.objectContaining({ status: 'rejected' }));
      expect(await Comments.findVisible('visible')).toBeNull();
      expect(await Comments.setStatus('unknown', { status: 'approved', moderatedBy: 'golden_admin', moderatedAt })).toBeNull();
    });

    test('remove deletes any comment and gives it back; null when unknown', async () => {
      expect(await Comments.remove('pending')).toEqual(expect.objectContaining({ commentId: 'pending', status: 'pending' }));
      expect(await Comments.remove('pending')).toBeNull();
      expect(await Comments.listVisibleForEvent(EVENT, { limit: 5 })).toEqual(expect.objectContaining({ total: 1 }));
    });
  });

  describe('helpful marks', () => {
    beforeEach(() => backend.insertComments([seeded('report'), seeded('pending', { status: 'pending' })]));

    test('an account marks a comment once: a second mark changes nothing', async () => {
      const first = await Comments.addHelpfulMark('report', VOTER);
      expect(first).toEqual({ comment: expect.objectContaining({ commentId: 'report', helpfulAccountIds: [VOTER] }), added: true });

      const again = await Comments.addHelpfulMark('report', VOTER);
      expect(again).toEqual({ comment: expect.objectContaining({ helpfulAccountIds: [VOTER] }), added: false });

      const other = await Comments.addHelpfulMark('report', OTHER_VOTER);
      expect(other.comment.helpfulAccountIds).toEqual([VOTER, OTHER_VOTER]);
    });

    test('removeHelpfulMark removes only that account\'s mark; a comment without one is unchanged', async () => {
      await Comments.addHelpfulMark('report', VOTER);
      await Comments.addHelpfulMark('report', OTHER_VOTER);

      expect((await Comments.removeHelpfulMark('report', VOTER)).helpfulAccountIds).toEqual([OTHER_VOTER]);
      expect((await Comments.removeHelpfulMark('report', VOTER)).helpfulAccountIds).toEqual([OTHER_VOTER]);
    });

    test('null for a hidden or unknown comment', async () => {
      expect(await Comments.addHelpfulMark('pending', VOTER)).toBeNull();
      expect(await Comments.addHelpfulMark('unknown', VOTER)).toBeNull();
      expect(await Comments.removeHelpfulMark('pending', VOTER)).toBeNull();
      expect(await Comments.removeHelpfulMark('unknown', VOTER)).toBeNull();
    });
  });

  describe('issue reports', () => {
    beforeEach(() => backend.insertComments([seeded('report'), seeded('pending', { status: 'pending' })]));

    test('one report per account: a second one replaces the reason and time', async () => {
      const first = await Comments.saveIssueReport('report', { accountId: VOTER, reason: 'unclear', createdAt: at('2026-05-10T00:00:00.000Z') });
      expect(first.issueReports).toEqual([{ accountId: VOTER, reason: 'unclear', createdAt: at('2026-05-10T00:00:00.000Z') }]);

      const second = await Comments.saveIssueReport('report', { accountId: VOTER, reason: 'duplicate', createdAt: at('2026-05-11T00:00:00.000Z') });
      expect(second.issueReports).toEqual([{ accountId: VOTER, reason: 'duplicate', createdAt: at('2026-05-11T00:00:00.000Z') }]);

      const other = await Comments.saveIssueReport('report', { accountId: OTHER_VOTER, reason: 'not_related', createdAt: at('2026-05-12T00:00:00.000Z') });
      expect(other.issueReports.map(({ accountId, reason }) => [accountId, reason])).toEqual([[VOTER, 'duplicate'], [OTHER_VOTER, 'not_related']]);
    });

    test('reports at the same time by one account still leave one', async () => {
      await Promise.all(['unclear', 'duplicate', 'inappropriate'].map((reason) => (
        Comments.saveIssueReport('report', { accountId: VOTER, reason, createdAt: at('2026-05-10T00:00:00.000Z') }))));

      expect((await Comments.findVisible('report')).issueReports).toHaveLength(1);
    });

    test('null for a hidden or unknown comment', async () => {
      const report = { accountId: VOTER, reason: 'unclear', createdAt: at('2026-05-10T00:00:00.000Z') };
      expect(await Comments.saveIssueReport('pending', report)).toBeNull();
      expect(await Comments.saveIssueReport('unknown', report)).toBeNull();
    });
  });

  describe('contribution points', () => {
    const entry = (fields = {}) => ({
      dedupeKey: `${VOTER}:report_marked_helpful:comment:report`,
      accountId: VOTER,
      actionType: 'report_marked_helpful',
      targetType: 'comment',
      targetId: 'report',
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
});
