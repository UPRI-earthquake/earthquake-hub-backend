const Comment = require('../models/comments.model');

// Create a new comment
async function createComment(commentData) {
  const comment = new Comment({
    ...commentData,
  });
  return await comment.save();
}

// Get all comments for a specific events
async function getCommentsByEventId(eventId) {
  return await Comment.find({ eventId }).sort({ createdAt: -1 }); // Sort by newest first
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
