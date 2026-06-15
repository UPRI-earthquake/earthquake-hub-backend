const Comment = require('../models/comments.model');
const Event = require('../models/events.model');

// Create a new comment
async function createComment({
  eventId,
  accountId,
  username = 'Anonymous',
  content,
  imageURL,
}) {
  const normalizedContent = typeof content === 'string' ? content.trim() : '';
  const comment = new Comment({
    eventId,
    accountId: accountId || null,
    username: username || 'Anonymous',
    ...(normalizedContent ? { content: normalizedContent } : {}),
    ...(imageURL ? { imageURL } : {}),
  });
  return await comment.save();
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
      .limit(limit),
    Comment.countDocuments({ eventId }),
  ]);

  return { comments, total, limit, offset };
}

// Delete comment (reserved for admin only)
async function deleteComment(commentId) {
  return await Comment.findOneAndDelete({ commentId });
}


module.exports = {
  createComment,
  getCommentsByEventId,
  deleteComment,
};
