const Comment = require('../models/comments.model');
const Event = require('../models/events.model');

const COMMENT_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
});
const COMMENT_ISSUE_REASON = Object.freeze({
  DUPLICATE: 'duplicate',
  UNCLEAR: 'unclear',
  WRONG_LOCATION: 'wrong_location',
  NOT_RELATED: 'not_related',
  INAPPROPRIATE: 'inappropriate',
});
const COMMENT_STATUS_VALUES = Object.values(COMMENT_STATUS);
const COMMENT_ISSUE_REASON_VALUES = Object.values(COMMENT_ISSUE_REASON);
const DEFAULT_COMMENT_STATUS = COMMENT_STATUS.APPROVED;

function normalizeCommentStatus(status, fallback = DEFAULT_COMMENT_STATUS) {
  return COMMENT_STATUS_VALUES.includes(status) ? status : fallback;
}

function getDefaultCommentStatus() {
  return normalizeCommentStatus(process.env.COMMENTS_DEFAULT_STATUS, DEFAULT_COMMENT_STATUS);
}

function normalizeAccountId(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value.toString === 'function') return value.toString();
  return String(value);
}

function getHelpfulAccountIds(source) {
  return Array.isArray(source?.helpfulAccountIds) ? source.helpfulAccountIds : [];
}

function buildVisibleCommentByIdQuery(commentId) {
  return {
    commentId,
    $or: [
      { status: COMMENT_STATUS.APPROVED },
      { status: { $exists: false } },
    ],
  };
}

function toPublicComment(comment, { viewerAccountId } = {}) {
  if (!comment) return null;
  const source = typeof comment.toObject === 'function'
    ? comment.toObject()
    : comment;
  const helpfulAccountIds = getHelpfulAccountIds(source);
  const normalizedViewerAccountId = normalizeAccountId(viewerAccountId);

  return {
    commentId: source.commentId,
    username: source.username || 'Anonymous',
    ...(source.content ? { content: source.content } : {}),
    ...(source.imageURL ? { imageURL: source.imageURL } : {}),
    helpfulCount: helpfulAccountIds.length,
    viewerHasMarkedHelpful: Boolean(
      normalizedViewerAccountId &&
      helpfulAccountIds.some((accountId) => normalizeAccountId(accountId) === normalizedViewerAccountId)
    ),
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
}

function toAdminComment(comment) {
  if (!comment) return null;
  const source = typeof comment.toObject === 'function'
    ? comment.toObject()
    : comment;

  return {
    ...toPublicComment(source),
    eventId: source.eventId,
    eventPublicID: source.eventPublicID,
    accountId: source.accountId || null,
    status: normalizeCommentStatus(source.status),
    moderatedBy: source.moderatedBy,
    moderatedAt: source.moderatedAt,
  };
}

function encodePaginationCursor(comment) {
  if (!comment?.createdAt || !comment?.commentId) return null;
  const payload = JSON.stringify({
    createdAt: new Date(comment.createdAt).toISOString(),
    commentId: comment.commentId,
  });
  return Buffer.from(payload, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodePaginationCursor(cursor) {
  if (!cursor) return null;

  try {
    const normalizedCursor = String(cursor).replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(Buffer.from(normalizedCursor, 'base64').toString('utf8'));
    const createdAt = new Date(payload.createdAt);
    const commentId = typeof payload.commentId === 'string' ? payload.commentId : '';

    if (Number.isNaN(createdAt.getTime()) || !commentId) {
      throw new Error('Invalid cursor payload.');
    }

    return { createdAt, commentId };
  } catch (_) {
    const error = new Error('Invalid comment pagination cursor.');
    error.name = 'ValidationError';
    error.details = [{ message: 'Invalid comment pagination cursor.' }];
    throw error;
  }
}

function buildVisibleCommentQuery(event, cursor) {
  const eventPublicID = typeof event.publicID === 'string' ? event.publicID.trim() : '';
  const query = {
    $and: [
      {
        $or: [
          { eventId: event._id },
          ...(eventPublicID ? [{ eventPublicID }] : []),
        ],
      },
      {
        $or: [
          { status: COMMENT_STATUS.APPROVED },
          { status: { $exists: false } },
        ],
      },
    ],
  };

  const decodedCursor = decodePaginationCursor(cursor);
  if (decodedCursor) {
    query.$and.push({
      $or: [
        { createdAt: { $lt: decodedCursor.createdAt } },
        { createdAt: decodedCursor.createdAt, commentId: { $lt: decodedCursor.commentId } },
      ],
    });
  }

  return query;
}

// Create a new comment
async function createComment({
  eventId,
  accountId,
  username = 'Anonymous',
  content,
  imageURL,
}) {
  const event = await Event.findById(eventId).select('_id publicID').lean();
  if (!event) {
    return null;
  }

  const normalizedContent = typeof content === 'string' ? content.trim() : '';
  const comment = new Comment({
    eventId: event._id,
    eventPublicID: event.publicID,
    accountId: accountId || null,
    username: username || 'Anonymous',
    ...(normalizedContent ? { content: normalizedContent } : {}),
    ...(imageURL ? { imageURL } : {}),
    status: getDefaultCommentStatus(),
  });
  const savedComment = await comment.save();
  const publicComment = toPublicComment(savedComment);
  return {
    ...publicComment,
    status: normalizeCommentStatus(savedComment.status),
  };
}

// Get all comments for a specific event
async function getCommentsByEventId(eventId, { limit = 20, offset = 0, cursor = '', viewerAccountId = null } = {}) {
  const event = await Event.findById(eventId).select('_id publicID').lean();
  if (!event) {
    return null;
  }

  const query = buildVisibleCommentQuery(event, cursor);
  const shouldUseOffset = !cursor && offset > 0;

  const [comments, total] = await Promise.all([
    Comment.find(query)
      .sort({ createdAt: -1, commentId: -1 })
      .skip(shouldUseOffset ? offset : 0)
      .limit(limit + 1)
      .select('commentId username content imageURL helpfulAccountIds createdAt updatedAt -_id')
      .lean(),
    Comment.countDocuments(query),
  ]);

  const hasMore = comments.length > limit;
  const visibleComments = hasMore ? comments.slice(0, limit) : comments;

  return {
    comments: visibleComments.map((comment) => toPublicComment(comment, { viewerAccountId })),
    total,
    limit,
    offset: shouldUseOffset ? offset : 0,
    nextCursor: hasMore ? encodePaginationCursor(visibleComments[visibleComments.length - 1]) : null,
    hasMore,
  };
}

// Delete comment (reserved for admin only)
async function deleteComment(commentId) {
  return await Comment.findOneAndDelete({ commentId });
}

async function updateCommentStatus(commentId, status, moderatedBy) {
  const normalizedStatus = normalizeCommentStatus(status, null);
  if (!normalizedStatus) {
    return { invalidStatus: true };
  }

  const updatedComment = await Comment.findOneAndUpdate(
    { commentId },
    {
      $set: {
        status: normalizedStatus,
        moderatedBy: moderatedBy || 'admin',
        moderatedAt: new Date(),
      },
    },
    { new: true },
  );

  return toAdminComment(updatedComment);
}

async function markCommentHelpful(commentId, accountId) {
  if (!accountId) {
    return { unauthenticated: true };
  }

  const updatedComment = await Comment.findOneAndUpdate(
    buildVisibleCommentByIdQuery(commentId),
    { $addToSet: { helpfulAccountIds: accountId } },
    { new: true },
  ).select('commentId username content imageURL helpfulAccountIds createdAt updatedAt');

  return toPublicComment(updatedComment, { viewerAccountId: accountId });
}

async function unmarkCommentHelpful(commentId, accountId) {
  if (!accountId) {
    return { unauthenticated: true };
  }

  const updatedComment = await Comment.findOneAndUpdate(
    buildVisibleCommentByIdQuery(commentId),
    { $pull: { helpfulAccountIds: accountId } },
    { new: true },
  ).select('commentId username content imageURL helpfulAccountIds createdAt updatedAt');

  return toPublicComment(updatedComment, { viewerAccountId: accountId });
}

async function reportCommentIssue(commentId, { accountId, reason }) {
  if (!accountId) {
    return { unauthenticated: true };
  }

  if (!COMMENT_ISSUE_REASON_VALUES.includes(reason)) {
    return { invalidReason: true };
  }

  const comment = await Comment.findOne(buildVisibleCommentByIdQuery(commentId));
  if (!comment) {
    return null;
  }

  const now = new Date();
  if (!Array.isArray(comment.issueReports)) {
    comment.issueReports = [];
  }
  const existingIssue = comment.issueReports.find(
    (issue) => normalizeAccountId(issue.accountId) === normalizeAccountId(accountId)
  );

  if (existingIssue) {
    existingIssue.reason = reason;
    existingIssue.createdAt = now;
  } else {
    comment.issueReports.push({ accountId, reason, createdAt: now });
  }

  await comment.save();
  return {
    commentId: comment.commentId,
    issueReported: true,
    reason,
  };
}

module.exports = {
  COMMENT_STATUS,
  COMMENT_ISSUE_REASON,
  createComment,
  getCommentsByEventId,
  deleteComment,
  updateCommentStatus,
  markCommentHelpful,
  unmarkCommentHelpful,
  reportCommentIssue,
  decodePaginationCursor,
  encodePaginationCursor,
  toPublicComment,
  toAdminComment,
};
