const Comment = require('../models/comments.model');
const Event = require('../models/events.model');

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
  });
  const savedComment = await comment.save();
  return toPublicComment(savedComment);
}

// Get all comments for a specific event
async function getCommentsByEventId(eventId, { limit = 20, offset = 0 } = {}) {
  const eventExists = await Event.exists({ _id: eventId });
  if (!eventExists) {
    return null;
  }

  const [comments, total] = await Promise.all([
    Comment.find({ eventId })
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .select('commentId username content imageURL createdAt updatedAt -_id')
      .lean(),
    Comment.countDocuments({ eventId }),
  ]);

  return { comments: comments.map(toPublicComment), total, limit, offset };
}

// Delete comment (reserved for admin only)
async function deleteComment(commentId) {
  return await Comment.findOneAndDelete({ commentId });
}


module.exports = {
  createComment,
  getCommentsByEventId,
  deleteComment,
  toPublicComment,
};
