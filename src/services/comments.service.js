const Comment = require('../models/comments.model');
const Event = require('../models/events.model');
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
const CANONICAL_UPLOAD_PREFIX = '/uploads/';
const LEGACY_UPLOAD_PREFIX = '/uploads_dev/';

function normalizeReportImageUrl(value) {
  if (typeof value !== 'string') return '';
  const imageUrl = value.trim();
  if (!imageUrl) return '';
  if (imageUrl.startsWith(LEGACY_UPLOAD_PREFIX)) {
    return `${CANONICAL_UPLOAD_PREFIX}${imageUrl.slice(LEGACY_UPLOAD_PREFIX.length)}`;
  }
  try {
    const absoluteUrl = new URL(imageUrl);
    if (['http:', 'https:'].includes(absoluteUrl.protocol) && absoluteUrl.pathname.startsWith(LEGACY_UPLOAD_PREFIX)) {
      return `${CANONICAL_UPLOAD_PREFIX}${absoluteUrl.pathname.slice(LEGACY_UPLOAD_PREFIX.length)}${absoluteUrl.search}`;
    }
  } catch {
    // Relative canonical paths are returned unchanged below.
  }
  return imageUrl;
}

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
    ...(normalizeReportImageUrl(source.imageURL) ? { imageURL: normalizeReportImageUrl(source.imageURL) } : {}),
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

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toModerationQueueComment(comment) {
  const source = typeof comment?.toObject === 'function' ? comment.toObject() : comment;
  if (!source) return null;
  const issueReasons = (Array.isArray(source.issueReports) ? source.issueReports : []).reduce((counts, issue) => {
    const reason = COMMENT_ISSUE_REASON_VALUES.includes(issue?.reason) ? issue.reason : 'unknown';
    counts[reason] = (counts[reason] || 0) + 1;
    return counts;
  }, {});
  return {
    commentId: source.commentId,
    eventPublicID: source.eventPublicID || '',
    username: source.username || 'Anonymous',
    content: source.content || '',
    imageURL: normalizeReportImageUrl(source.imageURL),
    status: normalizeCommentStatus(source.status),
    helpfulCount: getHelpfulAccountIds(source).length,
    issueCount: Array.isArray(source.issueReports) ? source.issueReports.length : 0,
    issueReasons,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    moderatedBy: source.moderatedBy || '',
    moderatedAt: source.moderatedAt || null,
  };
}

async function getAdminModerationSummary() {
  const [total, pending, approved, rejected, withImages, withIssues] = await Promise.all([
    Comment.countDocuments({}),
    Comment.countDocuments({ status: COMMENT_STATUS.PENDING }),
    Comment.countDocuments({ status: COMMENT_STATUS.APPROVED }),
    Comment.countDocuments({ status: COMMENT_STATUS.REJECTED }),
    Comment.countDocuments({ imageURL: { $exists: true, $ne: '' } }),
    Comment.countDocuments({ 'issueReports.0': { $exists: true } }),
  ]);
  return { total, pending, approved, rejected, withImages, withIssues };
}

async function getAdminModerationQueue({ status, hasImage, hasIssues, includeSummary = false, search, startTime, endTime, limit = 25, offset = 0 } = {}) {
  const query = {};
  if (status) query.status = status;
  if (hasImage === true) query.imageURL = { $exists: true, $ne: '' };
  if (hasImage === false) query.$or = [{ imageURL: { $exists: false } }, { imageURL: '' }, { imageURL: null }];
  if (hasIssues === true) query['issueReports.0'] = { $exists: true };
  if (hasIssues === false) query['issueReports.0'] = { $exists: false };
  if (startTime || endTime) {
    query.createdAt = {};
    if (startTime) query.createdAt.$gte = startTime;
    if (endTime) query.createdAt.$lte = endTime;
  }
  if (search) {
    const expression = new RegExp(escapeRegex(search), 'i');
    const searchTerms = [{ commentId: expression }, { eventPublicID: expression }, { username: expression }, { content: expression }];
    if (query.$or) query.$and = [{ $or: query.$or }, { $or: searchTerms }];
    else query.$or = searchTerms;
  }

  const [comments, total, summary] = await Promise.all([
    Comment.find(query)
      .sort({ createdAt: -1, commentId: -1 })
      .skip(offset)
      .limit(limit)
      .select('commentId eventPublicID username content imageURL status helpfulAccountIds issueReports createdAt updatedAt moderatedBy moderatedAt')
      .lean(),
    Comment.countDocuments(query),
    includeSummary ? getAdminModerationSummary() : Promise.resolve(undefined),
  ]);

  return {
    comments: comments.map(toModerationQueueComment),
    total,
    limit,
    offset,
    summary,
  };
}

async function markCommentHelpful(commentId, accountId) {
  if (!accountId) {
    return { unauthenticated: true };
  }

  const updatedComment = await Comment.findOneAndUpdate(
    {
      ...buildVisibleCommentByIdQuery(commentId),
      helpfulAccountIds: { $ne: accountId },
    },
    { $addToSet: { helpfulAccountIds: accountId } },
    { new: true },
  ).select('commentId username content imageURL accountId eventId eventPublicID helpfulAccountIds createdAt updatedAt');

  if (updatedComment) {
    await ContributionsService.recordHelpfulMarked({
      actorAccountId: accountId,
      comment: updatedComment,
    });
    return toPublicComment(updatedComment, { viewerAccountId: accountId });
  }

  const existingComment = await Comment.findOne(buildVisibleCommentByIdQuery(commentId))
    .select('commentId username content imageURL helpfulAccountIds createdAt updatedAt');

  return toPublicComment(existingComment, { viewerAccountId: accountId });
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
  getAdminModerationQueue,
  getAdminModerationSummary,
  deleteComment,
  updateCommentStatus,
  markCommentHelpful,
  unmarkCommentHelpful,
  reportCommentIssue,
  decodePaginationCursor,
  encodePaginationCursor,
  toPublicComment,
  toAdminComment,
  toModerationQueueComment,
  normalizeReportImageUrl,
};
