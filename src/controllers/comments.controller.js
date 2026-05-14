const Joi = require("joi");
const CommentsService = require("../services/comments.service");
const { responseCodes } = require("./responseCodes");
const { formatErrorMessage } = require("./helpers");

// Create a new comment for an event
exports.createComment = async (req, res, next) => {
  // Define validation schema
  console.log(req.body)
  const schema = Joi.object({
    eventId: Joi.string().required().messages({
      "any.required": "Event ID is required.",
      "string.base": "Event ID must be a string.",
    }),
    userId: Joi.string().trim().empty('').default('Anonymous').messages({
      "string.base": "User ID must be a string.",
    }),
    content: Joi.string().required().messages({
      "any.required": "Content is required.",
      "string.base": "Content must be a string.",
    }),
    imageURL: Joi.string().uri().optional().messages({
      "string.uri": "Image URL must be a valid URI.",
    }),
  });

  try {
    // Validate request body
    const { error, value } = schema.validate(req.body);
    if (error) {
      throw error;
    }

    // Create comment using the service
    const newComment = await CommentsService.createComment({
      ...value,
      userId: value.userId || 'Anonymous',
    });
    
    res.status(201).json({
        status: responseCodes.GENERIC_SUCCESS,
        message: "Comment created successfully",
        payload: newComment
    });
  } catch (err) {
    console.trace(`Creating comment unsuccessful \n ${err}`);
    next(err);
  }
};

// Get all comments for a specific event
exports.getCommentsByEventId = async (req, res, next) => {
  // Define validation schema
  const schema = Joi.object({
    eventId: Joi.string().required().messages({
      "any.required": "Event ID is required.",
      "string.base": "Event ID must be a string.",
    }),
  });

  try {
    // Validate query parameters
    const { error, value } = schema.validate(req.query);
    if (error) {
      throw error;
    }

    // Get comments using the service
    const comments = await CommentsService.getCommentsByEventId(value.eventId);
    
    res.status(200).json({
        status: responseCodes.GENERIC_SUCCESS,
        message: "Comments retrieved successfully",
        payload: comments
    });
  } catch (err) {
    console.trace(`Getting comments unsuccessful \n ${err}`);
    next(err);
  }
};

// Delete a comment (admin only)
exports.deleteComment = async (req, res, next) => {
  const schema = Joi.object({
    commentId: Joi.string().required().messages({
      "any.required": "Comment ID is required.",
      "string.base": "Comment ID must be a string.",
    }),
  });

  try {
    const { error, value } = schema.validate(req.params);
    if (error) {
      throw error;
    }

    const deletedComment = await CommentsService.deleteComment(value.commentId);
    if (!deletedComment) {
      res.status(404).json({
        status: responseCodes.GENERIC_ERROR,
        message: "Comment not found",
      });
      return;
    }
    
    res.status(200).json({
        status: responseCodes.GENERIC_SUCCESS,
        message: "Comment deleted successfully",
    });
  } catch (err) {
    console.trace(`Deleting comment unsuccessful \n ${err}`);
    next(err);
  }
}
