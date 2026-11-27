// The rules the community tables (comments, comment_helpful_marks, comment_issue_reports,
// contribution_events) enforce on every write, on a real PostgreSQL. In MongoDB only the app's own
// queries kept one vote and one flag per person, and nothing tied a comment to a real event.
const { startPostgres, PG_STARTUP_TIMEOUT_MS } = require('./fixtures/postgres.fixture');

describe('community tables', () => {
  let pg;

  beforeAll(async () => {
    pg = await startPostgres();
  }, PG_STARTUP_TIMEOUT_MS);

  afterEach(() => pg.clear());

  afterAll(async () => {
    if (pg) await pg.stop();
  });

  const insert = async (table, fields) => (await pg.db(table).insert(fields).returning('*'))[0];
  const insertEvent = (fields = {}) => insert('events', {
    public_id: 'upri2026jcom', origin_time: new Date('2026-05-01T08:00:00.000Z'), latitude: 14.67, longitude: 121.06, ...fields,
  });
  const insertAccount = (username) => insert('accounts', {
    username, email: `${username}@example.org`, password_hash: 'x', roles: ['citizen'],
  });
  const insertComment = (event, fields = {}) => insert('comments', { event_id: event.id, content: 'Felt strong shaking.', ...fields });
  const count = async (table, where = {}) => Number((await pg.db(table).where(where).count({ n: '*' }).first()).n);

  // An event, two accounts, and a report by the first
  const setup = async () => {
    const event = await insertEvent();
    const author = await insertAccount('golden_author');
    const voter = await insertAccount('golden_voter');
    const comment = await insertComment(event, { account_id: author.id, username: 'golden_author' });
    return { event, author, voter, comment };
  };

  describe('comments', () => {
    test('a new comment gets a public UUID, Anonymous, approved, and no moderation yet', async () => {
      const event = await insertEvent();
      const comment = await insertComment(event);

      expect(comment).toMatchObject({ username: 'Anonymous', status: 'approved', account_id: null, moderated_by: null, legacy_mongo_id: null });
      expect(comment.comment_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    test('can only point to a real event', async () => {
      await expect(insert('comments', { event_id: '01900000-0000-7000-8000-000000000000', content: 'Hello.' }))
        .rejects.toThrow(/comments_event_id_foreign/);
      await expect(insert('comments', { content: 'Hello.' })).rejects.toThrow(/not-null/);
    });

    test.each([
      ['neither content nor an image', { content: null }, /comments_has_content_or_image/],
      ['blank content and no image', { content: '   ' }, /comments_has_content_or_image/],
      ['a blank username', { username: ' ' }, /comments_username_not_blank/],
      ['content over 1000 characters', { content: 'x'.repeat(1001) }, /value too long/],
      ['an unknown status', { status: 'hidden' }, /invalid input value for enum comment_status/],
    ])('rejects %s', async (_, fields, error) => {
      const event = await insertEvent();
      await expect(insertComment(event, fields)).rejects.toThrow(error);
    });

    test('an image alone, or 1000 characters, is enough', async () => {
      const event = await insertEvent();

      await expect(insertComment(event, { content: null, image_url: '/uploads/report.png' })).resolves.toBeTruthy();
      await expect(insertComment(event, { content: 'x'.repeat(1000) })).resolves.toBeTruthy();
    });

    test('rejects a second comment with the same comment_id', async () => {
      const event = await insertEvent();
      const first = await insertComment(event);

      await expect(insertComment(event, { comment_id: first.comment_id })).rejects.toThrow(/comments_comment_id_unique/);
    });

    test('updated_at moves on every update', async () => {
      const event = await insertEvent();
      const comment = await insertComment(event, { created_at: new Date('2026-05-02T00:00:00.000Z'), updated_at: new Date('2026-05-02T00:00:00.000Z') });

      const [updated] = await pg.db('comments').where({ id: comment.id }).update({ status: 'rejected' }).returning('updated_at');
      expect(updated.updated_at.getTime()).toBeGreaterThan(comment.updated_at.getTime());
    });
  });

  describe('helpful marks and issue reports', () => {
    test('one helpful mark per account per comment: a second is rejected', async () => {
      const { comment, voter, author } = await setup();
      await insert('comment_helpful_marks', { comment_id: comment.id, account_id: voter.id });
      await insert('comment_helpful_marks', { comment_id: comment.id, account_id: author.id });

      await expect(insert('comment_helpful_marks', { comment_id: comment.id, account_id: voter.id }))
        .rejects.toThrow(/comment_helpful_marks_pkey/);
      expect(await count('comment_helpful_marks', { comment_id: comment.id })).toBe(2);
    });

    test('one issue report per account per comment: a second is rejected; the reason must be known', async () => {
      const { comment, voter } = await setup();
      await insert('comment_issue_reports', { comment_id: comment.id, account_id: voter.id, reason: 'unclear' });

      await expect(insert('comment_issue_reports', { comment_id: comment.id, account_id: voter.id, reason: 'duplicate' }))
        .rejects.toThrow(/comment_issue_reports_pkey/);
      const other = await insertAccount('golden_other');
      await expect(insert('comment_issue_reports', { comment_id: comment.id, account_id: other.id, reason: 'downvote' }))
        .rejects.toThrow(/invalid input value for enum issue_reason/);
    });

    test('marks and reports point to real comments and accounts', async () => {
      const { comment, voter } = await setup();
      const nobody = '01900000-0000-7000-8000-000000000000';

      await expect(insert('comment_helpful_marks', { comment_id: nobody, account_id: voter.id })).rejects.toThrow(/comment_helpful_marks_comment_id_foreign/);
      await expect(insert('comment_helpful_marks', { comment_id: comment.id, account_id: nobody })).rejects.toThrow(/comment_helpful_marks_account_id_foreign/);
      await expect(insert('comment_issue_reports', { comment_id: comment.id, account_id: nobody, reason: 'unclear' }))
        .rejects.toThrow(/comment_issue_reports_account_id_foreign/);
    });
  });

  describe('contribution_events', () => {
    const entry = (account, fields = {}) => ({
      dedupe_key: `${account.id}:report_marked_helpful:comment:c1`, account_id: account.id, action_type: 'report_marked_helpful', target_id: 'c1', points: 1, ...fields,
    });

    test('defaults: a comment target, empty metadata', async () => {
      const { voter } = await setup();
      const row = await insert('contribution_events', entry(voter));

      expect(row).toMatchObject({ target_type: 'comment', metadata: {}, event_id: null, reason: null, legacy_mongo_id: null });
    });

    test('the same dedupe_key can\'t be counted twice', async () => {
      const { voter } = await setup();
      await insert('contribution_events', entry(voter));

      await expect(insert('contribution_events', entry(voter, { points: 5 }))).rejects.toThrow(/contribution_events_dedupe_key_unique/);
      const ignored = await pg.db('contribution_events').insert(entry(voter)).onConflict('dedupe_key').ignore().returning('id');
      expect(ignored).toEqual([]);
      expect(await count('contribution_events')).toBe(1);
    });

    test.each([
      ['an unknown action', { action_type: 'report_deleted' }, /invalid input value for enum contribution_action/],
      ['an unknown target type', { target_type: 'account' }, /invalid input value for enum contribution_target/],
      ['a blank dedupe_key', { dedupe_key: ' ' }, /contribution_events_dedupe_key_not_blank/],
      ['metadata that is not an object', { metadata: JSON.stringify(['a']) }, /contribution_events_metadata_is_object/],
    ])('rejects %s', async (_, fields, error) => {
      const { voter } = await setup();
      await expect(insert('contribution_events', entry(voter, fields))).rejects.toThrow(error);
    });
  });

  describe('deleting', () => {
    test('an event deletes its comments with their marks and reports; its points stay, unlinked', async () => {
      const { event, comment, voter } = await setup();
      await insert('comment_helpful_marks', { comment_id: comment.id, account_id: voter.id });
      await insert('comment_issue_reports', { comment_id: comment.id, account_id: voter.id, reason: 'unclear' });
      const points = await insert('contribution_events', {
        dedupe_key: 'k', account_id: voter.id, action_type: 'report_marked_helpful', event_id: event.id, points: 1,
      });

      await pg.db('events').where({ id: event.id }).del();

      expect(await count('comments')).toBe(0);
      expect(await count('comment_helpful_marks')).toBe(0);
      expect(await count('comment_issue_reports')).toBe(0);
      expect(await pg.db('contribution_events').where({ id: points.id }).first()).toMatchObject({ event_id: null, points: 1 });
    });

    test('an account keeps its comments (no longer linked, same username) and loses its marks, reports and points', async () => {
      const { event, comment, author, voter } = await setup();
      const other = await insertComment(event, { username: 'Anonymous', content: 'Me too.' });
      await insert('comment_helpful_marks', { comment_id: other.id, account_id: author.id });
      await insert('comment_helpful_marks', { comment_id: comment.id, account_id: voter.id });
      await insert('comment_issue_reports', { comment_id: other.id, account_id: author.id, reason: 'duplicate' });
      await insert('contribution_events', { dedupe_key: 'author-posted', account_id: author.id, action_type: 'report_posted', points: 5 });
      await insert('contribution_events', { dedupe_key: 'voter-marked', account_id: voter.id, action_type: 'report_marked_helpful', points: 1 });

      await pg.db('accounts').where({ id: author.id }).del();

      expect(await pg.db('comments').where({ id: comment.id }).first()).toMatchObject({ account_id: null, username: 'golden_author' });
      expect(await pg.db('comment_helpful_marks').select('account_id')).toEqual([{ account_id: voter.id }]);
      expect(await count('comment_issue_reports')).toBe(0);
      expect(await pg.db('contribution_events').pluck('dedupe_key')).toEqual(['voter-marked']);
    });
  });
});
