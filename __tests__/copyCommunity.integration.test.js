const mongoose = require('mongoose');
const { copyCommunity } = require('../scripts/copy-community-to-postgres');
const { startMongo, MONGO_STARTUP_TIMEOUT_MS } = require('./fixtures/mongo.fixture');
const { startPostgres, PG_STARTUP_TIMEOUT_MS } = require('./fixtures/postgres.fixture');

const oid = (hex) => new mongoose.Types.ObjectId(hex);
const at = (iso) => new Date(iso);

// MongoDB ids of what Steps 2 and 3 copied (accounts, events), and of records that no longer exist
const ACCOUNT = { author: oid('6c000000000000000000a001'), voter: oid('6c000000000000000000a002'), gone: oid('6c000000000000000000a0ff') };
const EVENT = { quezon: oid('6c000000000000000000e001'), davao: oid('6c000000000000000000e002'), gone: oid('6c000000000000000000e0ff') };
const commentId = (n) => `c0000000-0000-4000-8000-00000000000${n}`;

// A comment as the app stores it today
const comment = (n, fields = {}) => ({
  _id: oid(`6c00000000000000000c000${n}`),
  commentId: commentId(n),
  eventId: EVENT.quezon,
  eventPublicID: 'upri2026jabc',
  accountId: ACCOUNT.author,
  username: 'golden_author',
  content: 'Strong shaking in Quezon City.',
  status: 'approved',
  helpfulAccountIds: [],
  issueReports: [],
  createdAt: at('2026-05-02T00:00:00.000Z'),
  updatedAt: at('2026-05-03T00:00:00.000Z'),
  __v: 0,
  ...fields,
});

// A points entry as the app stores it today
const points = (n, fields = {}) => ({
  _id: oid(`6c00000000000000000f000${n}`),
  dedupeKey: `${ACCOUNT.voter}:report_marked_helpful:comment:${commentId(1)}#${n}`,
  accountId: ACCOUNT.voter,
  actionType: 'report_marked_helpful',
  targetType: 'comment',
  targetId: commentId(1),
  eventId: EVENT.quezon,
  eventPublicID: 'upri2026jabc',
  points: 1,
  createdAt: at('2026-05-04T00:00:00.000Z'),
  updatedAt: at('2026-05-04T00:00:00.000Z'),
  ...fields,
});

describe('scripts/copy-community-to-postgres', () => {
  let mongo;
  let pg;
  let lines;
  let pgId; // PostgreSQL ids of the accounts and events, by name
  const comments = () => mongoose.connection.collection('comments');
  const contributions = () => mongoose.connection.collection('contributionevents');
  const copy = (options = {}) => copyCommunity({ db: pg.db, log: (line) => lines.push(line), ...options });
  const pgComment = (n) => pg.db('comments').where({ comment_id: commentId(n) }).first();
  const pgCount = async (table) => Number((await pg.db(table).count({ n: '*' }).first()).n);
  const marksOf = (n) => pg.db('comment_helpful_marks AS m').join('comments AS c', 'c.id', 'm.comment_id').join('accounts AS a', 'a.id', 'm.account_id')
    .where('c.comment_id', commentId(n)).orderBy('a.username').select('a.username', 'm.created_at');
  const reportsOf = (n) => pg.db('comment_issue_reports AS r').join('comments AS c', 'c.id', 'r.comment_id').join('accounts AS a', 'a.id', 'r.account_id')
    .where('c.comment_id', commentId(n)).orderBy('a.username').select('a.username', 'r.reason', 'r.created_at');

  beforeAll(async () => {
    [mongo, pg] = await Promise.all([startMongo(), startPostgres()]);
  }, Math.max(MONGO_STARTUP_TIMEOUT_MS, PG_STARTUP_TIMEOUT_MS));

  // The accounts and events Steps 2 and 3 copied
  beforeEach(async () => {
    lines = [];
    pgId = {};
    for (const [name, legacyId] of Object.entries({ author: ACCOUNT.author, voter: ACCOUNT.voter })) {
      [{ id: pgId[name] }] = await pg.db('accounts').insert({
        legacy_mongo_id: String(legacyId), username: `golden_${name}`, email: `${name}@example.org`, password_hash: 'x', roles: pg.db.raw("'{citizen}'"),
      }).returning('id');
    }
    for (const [name, legacyId, publicId] of [['quezon', EVENT.quezon, 'upri2026jabc'], ['davao', EVENT.davao, 'upri2026jdef']]) {
      [{ id: pgId[name] }] = await pg.db('events').insert({
        legacy_mongo_id: String(legacyId), public_id: publicId, origin_time: at('2026-05-01T08:00:00.000Z'), latitude: 14.6, longitude: 121,
      }).returning('id');
    }
  });

  afterEach(() => Promise.all([mongo.clear(), pg.clear()]));

  afterAll(async () => {
    await Promise.all([mongo && mongo.stop(), pg && pg.stop()]);
  });

  test('copies a comment with its helpful marks and issue reports, and the points entries', async () => {
    await comments().insertOne(comment(1, {
      imageURL: '/uploads/report.png',
      status: 'rejected',
      moderatedBy: 'golden_admin',
      moderatedAt: at('2026-05-03T00:00:00.000Z'),
      helpfulAccountIds: [ACCOUNT.voter, ACCOUNT.author],
      issueReports: [{ accountId: ACCOUNT.voter, reason: 'unclear', createdAt: at('2026-05-02T12:00:00.000Z') }],
    }));
    await contributions().insertMany([
      points(1),
      points(2, {
        dedupeKey: `${ACCOUNT.author}:report_posted:comment:${commentId(1)}`, accountId: ACCOUNT.author, actionType: 'report_posted', points: 5, metadata: { source: 'web' },
      }),
      points(3, { actionType: 'report_issue_submitted', dedupeKey: 'issue', points: 0, reason: 'unclear', targetType: undefined }),
    ]);

    const result = await copy();

    expect(result.ok).toBe(true);
    expect(await pgComment(1)).toMatchObject({
      legacy_mongo_id: String(comment(1)._id),
      event_id: pgId.quezon,
      account_id: pgId.author,
      username: 'golden_author',
      content: 'Strong shaking in Quezon City.',
      image_url: '/uploads/report.png',
      status: 'rejected',
      moderated_by: 'golden_admin',
      moderated_at: at('2026-05-03T00:00:00.000Z'),
      created_at: at('2026-05-02T00:00:00.000Z'),
      updated_at: at('2026-05-03T00:00:00.000Z'),
    });
    // MongoDB kept no time per mark: the comment's updated_at
    expect(await marksOf(1)).toEqual([
      { username: 'golden_author', created_at: at('2026-05-03T00:00:00.000Z') },
      { username: 'golden_voter', created_at: at('2026-05-03T00:00:00.000Z') },
    ]);
    expect(await reportsOf(1)).toEqual([{ username: 'golden_voter', reason: 'unclear', created_at: at('2026-05-02T12:00:00.000Z') }]);

    const rows = await pg.db('contribution_events').orderBy('legacy_mongo_id');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      legacy_mongo_id: String(points(1)._id),
      dedupe_key: points(1).dedupeKey,
      account_id: pgId.voter,
      action_type: 'report_marked_helpful',
      target_type: 'comment',
      target_id: commentId(1),
      event_id: pgId.quezon,
      points: 1,
      reason: null,
      metadata: {},
      created_at: at('2026-05-04T00:00:00.000Z'),
    });
    expect(rows[1]).toMatchObject({ account_id: pgId.author, action_type: 'report_posted', points: 5, metadata: { source: 'web' } });
    expect(rows[2]).toMatchObject({ action_type: 'report_issue_submitted', target_type: 'comment', reason: 'unclear', points: 0 });
    expect(result.marks).toMatchObject({ mongoTotal: 2, written: 2 });
    expect(result.reports).toMatchObject({ mongoTotal: 1, written: 1 });
    expect(result.points).toMatchObject({ mongoTotal: 3, inserted: 3, skipped: [] });
    expect(lines.join('\n')).toMatch(/Validation passed/);
  });

  test('finds the event by eventPublicID when eventId matches no event, and reports it', async () => {
    await comments().insertOne(comment(1, { eventId: EVENT.gone, eventPublicID: 'upri2026jdef' }));

    const result = await copy();

    expect(result.ok).toBe(true);
    expect((await pgComment(1)).event_id).toBe(pgId.davao);
    expect(result.comments.byPublicId).toEqual([`${comment(1)._id} (${commentId(1)})`]);
  });

  test('skips and reports comments it can\'t copy, with their marks and reports', async () => {
    await comments().insertMany([
      comment(1, { eventId: EVENT.gone, eventPublicID: 'upri2026gone', helpfulAccountIds: [ACCOUNT.voter] }),
      comment(2, { content: '   ', imageURL: '' }),
      comment(3, { commentId: 'not-a-uuid', issueReports: [{ accountId: ACCOUNT.voter, reason: 'unclear' }] }),
      comment(4, { content: 'x'.repeat(1001) }),
      comment(5, { commentId: commentId(6) }),
      comment(6),
      comment(7, { content: '', imageURL: '/uploads/only.png' }),
    ]);

    const result = await copy();

    expect(result.ok).toBe(true);
    expect(result.comments.skipped).toEqual(expect.arrayContaining([
      { id: `${comment(1)._id} (${commentId(1)})`, reason: 'its event no longer exists' },
      { id: `${comment(2)._id} (${commentId(2)})`, reason: 'neither text nor an image' },
      { id: `${comment(3)._id} (not-a-uuid)`, reason: 'commentId missing or not a UUID' },
      { id: `${comment(4)._id} (${commentId(4)})`, reason: 'text longer than 1000 characters' },
      { id: `${comment(5)._id} (${commentId(6)})`, reason: `same commentId as ${comment(6)._id}` },
      { id: `${comment(6)._id} (${commentId(6)})`, reason: `same commentId as ${comment(5)._id}` },
    ]));
    expect(result.comments.skipped).toHaveLength(6);
    expect(await pgCount('comments')).toBe(1);
    expect(await pgComment(7)).toMatchObject({ content: null, image_url: '/uploads/only.png' });
    expect(result.marks).toMatchObject({ mongoTotal: 1, withSkippedComment: 1, written: 0 });
    expect(result.reports).toMatchObject({ mongoTotal: 1, withSkippedComment: 1, written: 0 });
    expect(lines.join('\n')).toMatch(/skipped: 6\n.*its event no longer exists/);
  });

  test('a deleted account: its comment is copied unlinked under the same username; its marks and reports are left out', async () => {
    await comments().insertOne(comment(1, {
      accountId: ACCOUNT.gone,
      username: 'old_user',
      helpfulAccountIds: [ACCOUNT.voter, ACCOUNT.gone, ACCOUNT.voter],
      issueReports: [
        { accountId: ACCOUNT.gone, reason: 'unclear', createdAt: at('2026-05-02T10:00:00.000Z') },
        { accountId: ACCOUNT.voter, reason: 'duplicate', createdAt: at('2026-05-02T12:00:00.000Z') },
        { accountId: ACCOUNT.voter, reason: 'unclear', createdAt: at('2026-05-02T11:00:00.000Z') },
        { accountId: ACCOUNT.author, reason: 'downvote', createdAt: at('2026-05-02T11:00:00.000Z') },
      ],
    }));
    const id = `${comment(1)._id} (${commentId(1)})`;

    const result = await copy();

    expect(result.ok).toBe(true);
    expect(await pgComment(1)).toMatchObject({ account_id: null, username: 'old_user' });
    expect(await marksOf(1)).toEqual([expect.objectContaining({ username: 'golden_voter' })]);
    // The account's latest report
    expect(await reportsOf(1)).toEqual([expect.objectContaining({ username: 'golden_voter', reason: 'duplicate' })]);
    expect(result.comments.accountGone).toEqual([id]);
    expect(result.marks).toMatchObject({ mongoTotal: 3, written: 1, noAccount: [{ id, count: 1 }], duplicates: [{ id, count: 1 }] });
    expect(result.reports).toMatchObject({
      mongoTotal: 4, written: 1, noAccount: [{ id, count: 1 }], duplicates: [{ id, count: 1 }], unknownReason: [{ id, count: 1 }],
    });
  });

  test('a comment from before moderation is copied as approved, an unknown status as pending (hidden)', async () => {
    const { status, ...legacy } = comment(1);
    await comments().insertMany([legacy, comment(2, { status: 'spam', username: '  ', helpfulAccountIds: undefined, issueReports: undefined })]);

    const result = await copy();

    expect(result.ok).toBe(true);
    expect(await pgComment(1)).toMatchObject({ status: 'approved' });
    expect(await pgComment(2)).toMatchObject({ status: 'pending', username: 'Anonymous' });
    expect(result.comments.beforeModeration).toHaveLength(1);
    expect(result.comments.unknownStatus).toEqual([{ id: `${comment(2)._id} (${commentId(2)})`, status: 'spam' }]);
  });

  test('points: skips what it can\'t copy, keeps an entry whose event is gone, and counts a dedupeKey once', async () => {
    await contributions().insertMany([
      points(1, { accountId: ACCOUNT.gone }),
      points(2, { actionType: 'report_deleted' }),
      points(3, { points: 1.5 }),
      points(4, { dedupeKey: '' }),
      points(5, { eventId: EVENT.gone, eventPublicID: 'upri2026gone' }),
      points(6, { dedupeKey: 'twice', createdAt: at('2026-05-05T00:00:00.000Z') }),
      points(7, { dedupeKey: 'twice', createdAt: at('2026-05-04T00:00:00.000Z') }),
      points(8, { dedupeKey: 'counted-after-the-switch' }),
      points(9, { metadata: ['a'] }),
    ]);
    // Recorded in PostgreSQL after the switch, before this (late) copy
    await pg.db('contribution_events').insert({ dedupe_key: 'counted-after-the-switch', account_id: pgId.voter, action_type: 'report_marked_helpful', points: 1 });

    const result = await copy();

    expect(result.ok).toBe(true);
    const label = (n) => `${points(n)._id} (${points(n).dedupeKey})`;
    expect(result.points.skipped).toEqual(expect.arrayContaining([
      { id: label(1), reason: 'its account no longer exists' },
      { id: label(2), reason: 'unknown action "report_deleted"' },
      { id: label(3), reason: 'points 1.5 not a whole number' },
      { id: `${points(4)._id}`, reason: 'no dedupeKey' },
      { id: `${points(6)._id} (twice)`, reason: `same dedupeKey as ${points(7)._id} (counted once)` },
    ]));
    expect(result.points).toMatchObject({ mongoTotal: 9, inserted: 3, alreadyCounted: [`${points(8)._id} (counted-after-the-switch)`] });
    expect(result.points.skipped).toHaveLength(5);
    expect(await pg.db('contribution_events').where({ legacy_mongo_id: String(points(5)._id) }).first())
      .toMatchObject({ event_id: null, metadata: { eventPublicID: 'upri2026gone' } });
    expect(result.points.unlinked).toEqual([label(5)]);
    expect(await pg.db('contribution_events').where({ dedupe_key: 'twice' }).first()).toMatchObject({ legacy_mongo_id: String(points(7)._id) });
    expect(await pg.db('contribution_events').where({ legacy_mongo_id: String(points(9)._id) }).first()).toMatchObject({ metadata: { value: ['a'] } });
  });

  test('re-runnable: nothing is added twice, MongoDB changes are copied, and comments changed in PostgreSQL keep their rows', async () => {
    await comments().insertMany([
      comment(1, { helpfulAccountIds: [ACCOUNT.voter] }),
      comment(2, { helpfulAccountIds: [ACCOUNT.voter], issueReports: [{ accountId: ACCOUNT.voter, reason: 'unclear', createdAt: at('2026-05-02T12:00:00.000Z') }] }),
    ]);
    await contributions().insertOne(points(1));
    expect((await copy()).ok).toBe(true);

    // Again, unchanged
    const again = await copy();
    expect(again.ok).toBe(true);
    expect(again.comments).toMatchObject({ inserted: 0, updated: 2, keptNewer: 0 });
    expect(again.points).toMatchObject({ inserted: 0, alreadyCopied: 1 });
    expect(await pgCount('comments')).toBe(2);
    expect(await pgCount('comment_helpful_marks')).toBe(2);
    expect(await pgCount('contribution_events')).toBe(1);

    // MongoDB: comment 1 gets a second mark. PostgreSQL (after the switch): comment 2 is moderated and
    // loses its mark (its updated_at moves)
    await comments().updateOne({ commentId: commentId(1) }, { $push: { helpfulAccountIds: ACCOUNT.author }, $set: { updatedAt: at('2026-05-06T00:00:00.000Z') } });
    await comments().updateOne({ commentId: commentId(2) }, { $set: { content: 'Edited in MongoDB.', updatedAt: at('2026-05-06T00:00:00.000Z') } });
    const pg2 = await pgComment(2);
    await pg.db('comment_helpful_marks').where({ comment_id: pg2.id }).del();
    await pg.db('comments').where({ id: pg2.id }).update({ status: 'rejected' });

    const third = await copy();

    expect(third.ok).toBe(true);
    expect(third.comments).toMatchObject({ inserted: 0, updated: 1, keptNewer: 1 });
    expect((await marksOf(1)).map((mark) => mark.username)).toEqual(['golden_author', 'golden_voter']);
    expect(await pgComment(2)).toMatchObject({ status: 'rejected', content: 'Strong shaking in Quezon City.' });
    expect(await marksOf(2)).toEqual([]);
    expect(await reportsOf(2)).toHaveLength(1);
    expect(third.marks).toMatchObject({ written: 2, keptWithComment: 1 });
  });

  test('a dry run writes nothing', async () => {
    await comments().insertOne(comment(1, { helpfulAccountIds: [ACCOUNT.voter] }));
    await contributions().insertOne(points(1));

    const result = await copy({ dryRun: true });

    expect(result.ok).toBe(true);
    expect(result.comments).toMatchObject({ inserted: 1 });
    expect(result.marks).toMatchObject({ written: 1 });
    expect(result.points).toMatchObject({ inserted: 1 });
    expect(await pgCount('comments')).toBe(0);
    expect(await pgCount('contribution_events')).toBe(0);
    expect(lines[0]).toMatch(/^\[dry run\]/);
  });
});
