// Comments in PostgreSQL: the same functions and comment shape as mongodb/comments.repo.js, which both
// must keep (__tests__/community.repo.integration.test.js). A comment is put together from:
//   comments                the comment; its event and account are foreign keys, shown as their
//                           MongoDB-style ids (eventId, accountId) with the event's public_id as
//                           eventPublicID
//   comment_helpful_marks   helpfulAccountIds, one row per account
//   comment_issue_reports   issueReports, one row per account
// Account ids going in (from session tokens) are MongoDB-style too, and are found in accounts here, so
// sessions from before the switch keep working (see legacyIds.js).
//
// Visible comments are the approved ones (copied comments from before moderation are approved). A
// commentId that isn't a UUID finds nothing, as an unknown one did in MongoDB. Every write to a
// comment's marks or reports also moves the comment's updated_at, as MongoDB's did, so the copy script
// can treat a comment and its rows as one unit. Functions that take { tx } run on that Knex transaction
// (postgres/transactions.js).
const { isUuid, byLegacyId, accountIdFor, eventIdFor, shownId } = require('./legacyIds');

const MAX_CONTENT_LENGTH = 1000;

const trimmedOrNull = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

// The error MongoDB's model gave for text over the limit, which the API answers with a 400
const contentTooLong = (content) => {
  const message = `Path \`content\` (\`${content}\`) is longer than the maximum allowed length (${MAX_CONTENT_LENGTH}).`;
  const error = new Error(`Comment validation failed: content: ${message}`);
  error.name = 'ValidationError';
  error.errors = { content: { message } };
  return error;
};

// `db` is a Knex instance (src/db/knex.js in the app, a test container's in integration tests)
const createCommentsRepo = (db) => {
  const q = (tx) => tx || db;

  // Comments with their event, account, marks and reports, as one query
  const selectComments = (k) => k('comments AS c')
    .join('events AS e', 'e.id', 'c.event_id')
    .leftJoin('accounts AS a', 'a.id', 'c.account_id')
    .select(
      'c.*',
      'e.legacy_mongo_id AS event_legacy_id',
      'e.public_id AS event_public_id',
      'a.legacy_mongo_id AS account_legacy_id',
      k.raw(`COALESCE((
        SELECT json_agg(COALESCE(btrim(ma.legacy_mongo_id), ma.id::text) ORDER BY m.created_at, ma.legacy_mongo_id)
        FROM comment_helpful_marks m JOIN accounts ma ON ma.id = m.account_id WHERE m.comment_id = c.id
      ), '[]') AS helpful_account_ids`),
      k.raw(`COALESCE((
        SELECT json_agg(json_build_object(
          'accountId', COALESCE(btrim(ra.legacy_mongo_id), ra.id::text), 'reason', r.reason, 'createdAt', r.created_at
        ) ORDER BY r.created_at, ra.legacy_mongo_id)
        FROM comment_issue_reports r JOIN accounts ra ON ra.id = r.account_id WHERE r.comment_id = c.id
      ), '[]') AS issue_reports`),
    );

  const toComment = (row) => {
    if (!row) return null;
    const comment = {
      commentId: row.comment_id,
      eventId: shownId(row.event_legacy_id, row.event_id),
      eventPublicID: row.event_public_id,
      accountId: row.account_id ? shownId(row.account_legacy_id, row.account_id) : null,
      username: row.username,
      status: row.status,
      helpfulAccountIds: row.helpful_account_ids,
      issueReports: row.issue_reports.map(({ accountId, reason, createdAt }) => ({ accountId, reason, createdAt: new Date(createdAt) })),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
    if (row.content !== null) comment.content = row.content;
    if (row.image_url !== null) comment.imageURL = row.image_url;
    if (row.moderated_by !== null) comment.moderatedBy = row.moderated_by;
    if (row.moderated_at !== null) comment.moderatedAt = row.moderated_at;
    return comment;
  };

  const findOne = async (where, tx) => toComment(await selectComments(q(tx)).where(where).first());

  // comments.id of a visible comment, or null (also for a commentId that isn't a UUID)
  const visibleRowId = async (commentId, tx) => {
    if (!isUuid(commentId)) return null;
    const row = await q(tx)('comments').select('id').where({ comment_id: commentId.toLowerCase(), status: 'approved' }).first();
    return row ? row.id : null;
  };

  // MongoDB moved a comment's updatedAt on every write to its marks or reports; so does this
  const touch = (id, tx) => q(tx)('comments').where({ id }).update({ updated_at: db.fn.now() });

  /***************************************************************************
    * create:
    *     Saves a new comment with a new commentId. fields: eventId, eventPublicID (the event, by its
    *     MongoDB-style id or publicID), accountId (MongoDB-style; null for anonymous), username,
    *     content and/or imageURL, status. Rejects as MongoDB did: a ValidationError (a 400 from the
    *     API) for text over 1000 characters, an Error for neither text nor an image.
    ***************************************************************************/
  async function create(fields, { tx } = {}) {
    const content = trimmedOrNull(fields.content);
    const imageUrl = trimmedOrNull(fields.imageURL);
    if (!content && !imageUrl) throw new Error('A report must include text or an image.');
    if (content && content.length > MAX_CONTENT_LENGTH) throw contentTooLong(content);

    const k = q(tx);
    // An account that no longer exists (a session outliving its account) posts unlinked
    const accountId = fields.accountId ? await accountIdFor(k, fields.accountId) : null;
    // Milliseconds, as MongoDB stored them: the paging cursor compares createdAt exactly
    const now = new Date();
    const [{ id }] = await k('comments').insert({
      event_id: await eventIdFor(k, { _id: fields.eventId, publicID: fields.eventPublicID }),
      account_id: accountId,
      username: trimmedOrNull(fields.username) || 'Anonymous',
      content,
      image_url: imageUrl,
      status: fields.status || 'approved',
      created_at: now,
      updated_at: now,
    }).returning('id');
    return findOne({ 'c.id': id }, tx);
  }

  // One page of an event's visible comments, newest first; see mongodb/comments.repo.js
  async function listVisibleForEvent(event, { limit, offset = 0, after = null }) {
    // The event's row, by its MongoDB-style id or its publicID
    const eventRows = db('events').select('id').where((where) => {
      const byId = byLegacyId(db, 'events', event._id);
      if (byId) where.whereIn('id', byId);
      const publicId = typeof event.publicID === 'string' ? event.publicID.trim() : '';
      if (publicId) where.orWhere('public_id', publicId);
      if (!byId && !publicId) where.whereRaw('false');
    });
    const filtered = (query) => {
      query.whereIn('c.event_id', eventRows).andWhere('c.status', 'approved');
      if (after) {
        query.andWhere((where) => where
          .where('c.created_at', '<', after.createdAt)
          .orWhere((tie) => {
            tie.where('c.created_at', after.createdAt);
            // A cursor made from a stored comment holds a UUID; anything else compares as text, as MongoDB did
            if (isUuid(after.commentId)) tie.andWhere('c.comment_id', '<', after.commentId.toLowerCase());
            else tie.andWhereRaw('c.comment_id::text < ?', [after.commentId]);
          }));
      }
      return query;
    };

    const [rows, counted] = await Promise.all([
      filtered(selectComments(db))
        .orderBy([{ column: 'c.created_at', order: 'desc' }, { column: 'c.comment_id', order: 'desc' }])
        .offset(offset)
        .limit(limit + 1),
      filtered(db('comments AS c').count({ n: '*' })).first(),
    ]);
    return { comments: rows.slice(0, limit).map(toComment), hasMore: rows.length > limit, total: Number(counted.n) };
  }

  // A visible comment, or null
  async function findVisible(commentId, { tx } = {}) {
    const id = await visibleRowId(commentId, tx);
    return id ? findOne({ 'c.id': id }, tx) : null;
  }

  // Deletes a comment, visible or not, with its marks and reports. Resolves to the deleted comment, or null.
  async function remove(commentId, { tx } = {}) {
    if (!isUuid(commentId)) return null;
    const comment = await findOne({ 'c.comment_id': commentId.toLowerCase() }, tx);
    if (!comment) return null;
    const deleted = await q(tx)('comments').where({ comment_id: commentId.toLowerCase() }).del();
    return deleted > 0 ? comment : null;
  }

  // Moderation on any comment, visible or not. Resolves to the updated comment, or null.
  async function setStatus(commentId, { status, moderatedBy, moderatedAt }, { tx } = {}) {
    if (!isUuid(commentId)) return null;
    const updated = await q(tx)('comments')
      .where({ comment_id: commentId.toLowerCase() })
      .update({ status, moderated_by: trimmedOrNull(moderatedBy), moderated_at: moderatedAt })
      .returning('id');
    return updated.length > 0 ? findOne({ 'c.id': updated[0].id }, tx) : null;
  }

  /***************************************************************************
    * addHelpfulMark:
    *     Marks a visible comment helpful for one account (MongoDB-style id): one row per account, so
    *     marking again changes nothing. An account that no longer exists can't mark.
    *
    * Returns:
    *     { comment, added }, or null when there is no visible comment with this commentId
    ***************************************************************************/
  async function addHelpfulMark(commentId, accountId, { tx } = {}) {
    const id = await visibleRowId(commentId, tx);
    if (!id) return null;
    const account = await accountIdFor(q(tx), accountId);
    let added = false;
    if (account) {
      const inserted = await q(tx)('comment_helpful_marks')
        .insert({ comment_id: id, account_id: account, created_at: new Date() })
        .onConflict(['comment_id', 'account_id'])
        .ignore()
        .returning('account_id');
      added = inserted.length > 0;
      if (added) await touch(id, tx);
    }
    return { comment: await findOne({ 'c.id': id }, tx), added };
  }

  // Removes one account's helpful mark from a visible comment (if it had one); the comment's updatedAt
  // moves either way, as in MongoDB. Resolves to the comment, or null.
  async function removeHelpfulMark(commentId, accountId, { tx } = {}) {
    const id = await visibleRowId(commentId, tx);
    if (!id) return null;
    const account = await accountIdFor(q(tx), accountId);
    if (account) await q(tx)('comment_helpful_marks').where({ comment_id: id, account_id: account }).del();
    await touch(id, tx);
    return findOne({ 'c.id': id }, tx);
  }

  // One account's issue report on a visible comment: a second replaces the reason and time of the
  // first. Resolves to the comment, or null.
  async function saveIssueReport(commentId, { accountId, reason, createdAt }, { tx } = {}) {
    const id = await visibleRowId(commentId, tx);
    if (!id) return null;
    const account = await accountIdFor(q(tx), accountId);
    if (account) {
      await q(tx)('comment_issue_reports')
        .insert({ comment_id: id, account_id: account, reason, created_at: createdAt })
        .onConflict(['comment_id', 'account_id'])
        .merge(['reason', 'created_at']);
      await touch(id, tx);
    }
    return findOne({ 'c.id': id }, tx);
  }

  return {
    create,
    listVisibleForEvent,
    findVisible,
    remove,
    setStatus,
    addHelpfulMark,
    removeHelpfulMark,
    saveIssueReport,
  };
};

module.exports = { createCommentsRepo };
