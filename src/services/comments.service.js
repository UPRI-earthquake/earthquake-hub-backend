const Comment = require('../models/comments.model');
const Event = require('../models/events.model');

const COMMENT_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
});
const COMMENT_STATUS_VALUES = Object.values(COMMENT_STATUS);
const DEFAULT_COMMENT_STATUS = COMMENT_STATUS.APPROVED;

function normalizeCommentStatus(status, fallback = DEFAULT_COMMENT_STATUS) {
  return COMMENT_STATUS_VALUES.includes(status) ? status : fallback;
}

function getDefaultCommentStatus() {
  return normalizeCommentStatus(process.env.COMMENTS_DEFAULT_STATUS, DEFAULT_COMMENT_STATUS);
}

function toPublicComment(comment) {
  if (!comment) return null;
  const source = typeof comment.toObject === 'function'
    ? comment.toObject()
    : comment;

  return {
    commentId: source.commentId,
    username: source.username || 'Anonymous',
    ...(source.content ? { content: source.content } : {}),
    ...(source.imageURL ? { imageURL: source.imageURL } : {}),
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

function buildVisibleCommentQuery(eventId, cursor) {
  const query = {
    eventId,
    status: COMMENT_STATUS.APPROVED,
  };

  const decodedCursor = decodePaginationCursor(cursor);
  if (decodedCursor) {
    query.$or = [
      { createdAt: { $lt: decodedCursor.createdAt } },
      { createdAt: decodedCursor.createdAt, commentId: { $lt: decodedCursor.commentId } },
    ];
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
  const eventExists = await Event.exists({ _id: eventId });
  if (!eventExists) {
    return null;
  }

  const normalizedContent = typeof content === 'string' ? content.trim() : '';
  const comment = new Comment({
    eventId,
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
async function getCommentsByEventId(eventId, { limit = 20, offset = 0, cursor = '' } = {}) {
  const eventExists = await Event.exists({ _id: eventId });
  if (!eventExists) {
    return null;
  }

  const query = buildVisibleCommentQuery(eventId, cursor);
  const shouldUseOffset = !cursor && offset > 0;

  const [comments, total] = await Promise.all([
    Comment.find(query)
      .sort({ createdAt: -1, commentId: -1 })
      .skip(shouldUseOffset ? offset : 0)
      .limit(limit + 1)
      .select('commentId username content imageURL createdAt updatedAt -_id')
      .lean(),
    Comment.countDocuments({ eventId, status: COMMENT_STATUS.APPROVED }),
  ]);

  const hasMore = comments.length > limit;
  const visibleComments = hasMore ? comments.slice(0, limit) : comments;

  return {
    comments: visibleComments.map(toPublicComment),
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

module.exports = {
  COMMENT_STATUS,
  createComment,
  getCommentsByEventId,
  deleteComment,
  updateCommentStatus,
  decodePaginationCursor,
  encodePaginationCursor,
  toPublicComment,
  toAdminComment,
};
