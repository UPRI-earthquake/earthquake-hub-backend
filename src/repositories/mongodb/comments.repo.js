// Comments (community reports on earthquakes) in MongoDB (`comments` collection), with their helpful
// marks and issue reports. postgres/comments.repo.js is the PostgreSQL version (COMMUNITY_DB picks one);
// both must pass __tests__/community.repo.integration.test.js.
//
// A comment comes back as:
//   { commentId, eventId, eventPublicID, accountId, username, content, imageURL, status, moderatedBy,
//     moderatedAt, helpfulAccountIds, issueReports: [{ accountId, reason, createdAt }], createdAt, updatedAt }
// Event and account ids are MongoDB-style strings, and accountId is null for an anonymous report.
// Fields a comment doesn't have are left out: content on an image-only report, imageURL, moderatedBy and
// moderatedAt until moderated, and status on records from before moderation (callers treat those as
// approved). Helpful marks and issue reports are lists, so the PostgreSQL version can store them as rows
// without changing callers.
//
// "Visible" comments are the ones the public sees: approved, or from before moderation (no status).
//
// Functions that take { tx } run in that transaction: a Mongoose session (mongodb/transactions.js).
const Comment = require('../../models/comments.model');

const VISIBLE = { $or: [{ status: 'approved' }, { status: { $exists: false } }] };
const visibleById = (commentId) => ({ commentId, ...VISIBLE });

const OPTIONAL_FIELDS = ['content', 'imageURL', 'status', 'moderatedBy', 'moderatedAt'];

const toComment = (doc) => {
  if (!doc) return null;
  const comment = {
    commentId: doc.commentId,
    eventId: String(doc.eventId),
    eventPublicID: doc.eventPublicID,
    accountId: doc.accountId ? String(doc.accountId) : null,
    username: doc.username,
    helpfulAccountIds: (doc.helpfulAccountIds || []).map(String),
    issueReports: (doc.issueReports || []).map(({ accountId, reason, createdAt }) => ({
      accountId: String(accountId), reason, createdAt,
    })),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
  OPTIONAL_FIELDS.forEach((field) => {
    if (doc[field] !== undefined && doc[field] !== null) comment[field] = doc[field];
  });
  return comment;
};

/***************************************************************************
  * create:
  *     Saves a new comment with a new commentId.
  *
  * Inputs:
  *     fields  eventId, eventPublicID, accountId (null for anonymous), username, content and/or
  *             imageURL, status
  *
  * Returns:
  *     the comment. Rejects with a ValidationError (a 400 from the API) when it has neither text nor
  *     an image, or the text is over 1000 characters.
  ***************************************************************************/
async function create(fields, { tx } = {}) {
  const saved = await new Comment(fields).save({ session: tx });
  return toComment(saved.toObject());
}

/***************************************************************************
  * listVisibleForEvent:
  *     One page of an event's visible comments, newest first (createdAt, then commentId, both
  *     descending). A comment belongs to the event by eventId, or by eventPublicID when its eventId
  *     no longer matches.
  *
  * Inputs:
  *     event           { _id, publicID }, as EventsRepo.findRefById gives it
  *     options.limit   page size
  *     options.offset  comments to skip first
  *     options.after   { createdAt, commentId } of the last comment already shown (a cursor): only
  *                     comments after it in that order
  *
  * Returns:
  *     { comments, hasMore, total }. total counts every match, `after` included (on a cursor page,
  *     the comments from the cursor on).
  ***************************************************************************/
async function listVisibleForEvent(event, { limit, offset = 0, after = null }) {
  const eventPublicID = typeof event.publicID === 'string' ? event.publicID.trim() : '';
  const query = {
    $and: [
      { $or: [{ eventId: event._id }, ...(eventPublicID ? [{ eventPublicID }] : [])] },
      VISIBLE,
    ],
  };
  if (after) {
    query.$and.push({
      $or: [
        { createdAt: { $lt: after.createdAt } },
        { createdAt: after.createdAt, commentId: { $lt: after.commentId } },
      ],
    });
  }

  const [docs, total] = await Promise.all([
    Comment.find(query).sort({ createdAt: -1, commentId: -1 }).skip(offset).limit(limit + 1).lean(),
    Comment.countDocuments(query),
  ]);
  return { comments: docs.slice(0, limit).map(toComment), hasMore: docs.length > limit, total };
}

// A visible comment, or null
async function findVisible(commentId, { tx } = {}) {
  return toComment(await Comment.findOne(visibleById(commentId), null, { session: tx }).lean());
}

// Deletes a comment, visible or not. Resolves to the deleted comment, or null if there was none.
async function remove(commentId, { tx } = {}) {
  return toComment(await Comment.findOneAndDelete({ commentId }, { session: tx }).lean());
}

// Moderation: { status, moderatedBy, moderatedAt } on any comment, visible or not. Resolves to the
// updated comment, or null.
async function setStatus(commentId, { status, moderatedBy, moderatedAt }, { tx } = {}) {
  return toComment(await Comment.findOneAndUpdate(
    { commentId },
    { $set: { status, moderatedBy, moderatedAt } },
    { new: true, session: tx },
  ).lean());
}

/***************************************************************************
  * addHelpfulMark:
  *     Marks a visible comment helpful for one account. An account marks a comment at most once.
  *
  * Returns:
  *     { comment, added }: added is false when the account had already marked it (nothing changed,
  *     so no points are due). null when there is no visible comment with this commentId.
  ***************************************************************************/
async function addHelpfulMark(commentId, accountId, { tx } = {}) {
  const updated = await Comment.findOneAndUpdate(
    { ...visibleById(commentId), helpfulAccountIds: { $ne: accountId } },
    { $addToSet: { helpfulAccountIds: accountId } },
    { new: true, session: tx },
  ).lean();
  if (updated) return { comment: toComment(updated), added: true };

  const existing = await findVisible(commentId, { tx });
  return existing ? { comment: existing, added: false } : null;
}

// Removes one account's helpful mark from a visible comment (if it had one). Resolves to the comment, or
// null when there is no visible comment with this commentId.
async function removeHelpfulMark(commentId, accountId, { tx } = {}) {
  return toComment(await Comment.findOneAndUpdate(
    visibleById(commentId),
    { $pull: { helpfulAccountIds: accountId } },
    { new: true, session: tx },
  ).lean());
}

/***************************************************************************
  * saveIssueReport:
  *     Saves one account's private issue report on a visible comment. An account has at most one
  *     report per comment: a second one replaces the reason and time of the first.
  *
  * Inputs:
  *     commentId
  *     report      { accountId, reason, createdAt }
  *
  * Returns:
  *     the comment, or null when there is no visible comment with this commentId
  ***************************************************************************/
async function saveIssueReport(commentId, { accountId, reason, createdAt }, { tx } = {}) {
  const replace = () => Comment.findOneAndUpdate(
    { ...visibleById(commentId), 'issueReports.accountId': accountId },
    { $set: { 'issueReports.$.reason': reason, 'issueReports.$.createdAt': createdAt } },
    { new: true, runValidators: true, session: tx },
  ).lean();

  const replaced = await replace();
  if (replaced) return toComment(replaced);

  const added = await Comment.findOneAndUpdate(
    { ...visibleById(commentId), 'issueReports.accountId': { $ne: accountId } },
    { $push: { issueReports: { accountId, reason, createdAt } } },
    { new: true, runValidators: true, session: tx },
  ).lean();
  if (added) return toComment(added);

  // No visible comment, or the same account's report was added in between: then replace that one
  return toComment(await replace());
}

module.exports = {
  create,
  listVisibleForEvent,
  findVisible,
  remove,
  setStatus,
  addHelpfulMark,
  removeHelpfulMark,
  saveIssueReport,
};
