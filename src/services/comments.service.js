const CommentsRepo = require('../repositories/comments.repo');
const EventsRepo = require('../repositories/events.repo');
const ContributionsService = require('./contributions.service');

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

// source: a comment as the comments repository returns it
function toPublicComment(source, { viewerAccountId } = {}) {
  if (!source) return null;
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

function toAdminComment(source) {
  if (!source) return null;

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

// Create a new comment
async function createComment({
  eventId,
  accountId,
  username = 'Anonymous',
  content,
  imageURL,
}) {
  const event = await EventsRepo.findRefById(eventId);
  if (!event) {
    return null;
  }

  const normalizedContent = typeof content === 'string' ? content.trim() : '';
  const savedComment = await CommentsRepo.create({
    eventId: event._id,
    eventPublicID: event.publicID,
    accountId: accountId || null,
    username: username || 'Anonymous',
    ...(normalizedContent ? { content: normalizedContent } : {}),
    ...(imageURL ? { imageURL } : {}),
    status: getDefaultCommentStatus(),
  });
  await ContributionsService.recordReportPosted({
    accountId,
    comment: savedComment,
    hasImage: Boolean(imageURL),
  });
  const publicComment = toPublicComment(savedComment);
  return {
    ...publicComment,
    status: normalizeCommentStatus(savedComment.status),
  };
}

// Get all comments for a specific event
async function getCommentsByEventId(eventId, { limit = 20, offset = 0, cursor = '', viewerAccountId = null } = {}) {
  const event = await EventsRepo.findRefById(eventId);
  if (!event) {
    return null;
  }

  const shouldUseOffset = !cursor && offset > 0;
  const { comments: visibleComments, total, hasMore } = await CommentsRepo.listVisibleForEvent(event, {
    limit,
    offset: shouldUseOffset ? offset : 0,
    after: decodePaginationCursor(cursor),
  });

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
  return CommentsRepo.remove(commentId);
}

async function updateCommentStatus(commentId, status, moderatedBy) {
  const normalizedStatus = normalizeCommentStatus(status, null);
  if (!normalizedStatus) {
    return { invalidStatus: true };
  }

  const updatedComment = await CommentsRepo.setStatus(commentId, {
    status: normalizedStatus,
    moderatedBy: moderatedBy || 'admin',
    moderatedAt: new Date(),
  });

  return toAdminComment(updatedComment);
}

async function markCommentHelpful(commentId, accountId) {
  if (!accountId) {
    return { unauthenticated: true };
  }

  const marked = await CommentsRepo.addHelpfulMark(commentId, accountId);
  if (!marked) {
    return null;
  }

  // Points only for a new mark: marking again changes nothing
  if (marked.added) {
    await ContributionsService.recordHelpfulMarked({
      actorAccountId: accountId,
      comment: marked.comment,
    });
  }
  return toPublicComment(marked.comment, { viewerAccountId: accountId });
}

async function unmarkCommentHelpful(commentId, accountId) {
  if (!accountId) {
    return { unauthenticated: true };
  }

  const updatedComment = await CommentsRepo.removeHelpfulMark(commentId, accountId);

  return toPublicComment(updatedComment, { viewerAccountId: accountId });
}

async function reportCommentIssue(commentId, { accountId, reason }) {
  if (!accountId) {
    return { unauthenticated: true };
  }

  if (!COMMENT_ISSUE_REASON_VALUES.includes(reason)) {
    return { invalidReason: true };
  }

  // One report per account: a second one replaces the first
  const comment = await CommentsRepo.saveIssueReport(commentId, { accountId, reason, createdAt: new Date() });
  if (!comment) {
    return null;
  }

  await ContributionsService.recordIssueSubmitted({
    accountId,
    comment,
    reason,
  });
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
