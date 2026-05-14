const Joi = require("joi");
const CommentsService = require("../services/comments.service");
const { responseCodes } = require("./responseCodes");
const { formatErrorMessage } = require("./helpers");

// Create a new comment for an event
exports.createComment = async (req, res, next) => {
  // Define validation schema
  const schema = Joi.object({
    eventId: Joi.string().required().messages({
      "any.required": "Event ID is required.",
      "string.base": "Event ID must be a string.",
    }),
    username: Joi.string().trim().empty('').default('Anonymous').messages({
      "string.base": "Username must be a string.",
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

    const isAuthenticated = Boolean(req.isAuthenticated && req.username);

    // Create comment using the authenticated account identity when present.
    const newComment = await CommentsService.createComment({
      eventId: value.eventId,
      accountId: isAuthenticated ? req.accountId : undefined,
      username: isAuthenticated ? req.username : 'Anonymous',
      content: value.content,
      imageURL: value.imageURL || null
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
    eventId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required().messages({
      "any.required": "Event ID is required.",
      "string.base": "Event ID must be a string.",
      "string.pattern.base": "Event ID must be a valid ObjectId.",
    }),
    limit: Joi.number().integer().min(1).max(100).default(20).messages({
      "number.base": "Limit must be a number.",
      "number.integer": "Limit must be an integer.",
      "number.min": "Limit must be at least 1.",
      "number.max": "Limit must not exceed 100.",
    }),
    offset: Joi.number().integer().min(0).default(0).messages({
      "number.base": "Offset must be a number.",
      "number.integer": "Offset must be an integer.",
      "number.min": "Offset must be at least 0.",
    }),
  });

  try {
    // Validate query parameters
    const { error, value } = schema.validate(req.query);
    if (error) {
      throw error;
    }

    // Get comments using the service
    const commentsResult = await CommentsService.getCommentsByEventId(value.eventId, {
      limit: value.limit,
      offset: value.offset,
    });
    if (!commentsResult) {
      res.status(404).json({
        status: responseCodes.GENERIC_ERROR,
        message: "Event not found",
      });
      return;
    }
    
    res.status(200).json({
        status: responseCodes.GENERIC_SUCCESS,
        message: "Comments retrieved successfully",
        payload: commentsResult.comments,
        pagination: {
          total: commentsResult.total,
          limit: commentsResult.limit,
          offset: commentsResult.offset,
        },
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
