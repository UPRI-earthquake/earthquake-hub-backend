/**
 * @swagger
 *   components:
 *     schemas:
 *       Comment:
 *         type: object
 *         properties:
 *           _id:
 *             type: string
 *             description: Auto-generated ObjectId
 *           commentId:
 *             type: string
 *             description: Unique comment identifier (unique index enforced)
 *           eventId:
 *             type: string
 *             description: Reference to the Event ObjectId
 *           username:
 *             type: string
 *             description: Account identifier or Anonymous when not provided
 *           accountId:
 *             type: string
 *             description: Authenticated Account ObjectId when the comment is posted by a signed-in citizen
 *           content:
 *             type: string
 *             description: The text content of the comment
 *           imageURL:
 *             type: string
 *             description: Optional URL to an image attached to the comment
 *           createdAt:
 *             type: string
 *             format: date-time
 *           updatedAt:
 *             type: string
 *             format: date-time
 */

const mongoose = require('mongoose');
const { randomUUID } = require('crypto');

// Comments model: Simple display-only comments on events.
// No replies or likes yet.
const commentSchema = new mongoose.Schema(
  {
    commentId: {
      type: String,
      unique: true,
      index: true,
      default: () => randomUUID(),
    },
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Event',  // References the Event model
      required: true,
      index: true,
    },
    username: {
      type: String,
      default: 'Anonymous',
      trim: true,
      set: (value) => {
        if (value === undefined || value === null) {
          return 'Anonymous';
        }
        const normalizedValue = String(value).trim();
        return normalizedValue || 'Anonymous';
      },
    },
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      default: null,
      index: true,
    },
    content: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    imageURL: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,  // Adds createdAt and updatedAt automatically
  },
);

// Indexes for performance (e.g., querying comments by event or user)
commentSchema.index({ eventId: 1, createdAt: -1 });  // Sort comments by event and recency
commentSchema.index({ username: 1 });
commentSchema.index({ accountId: 1 });

commentSchema.pre('validate', function requireTextOrImage(next) {
  const hasContent = typeof this.content === 'string' && this.content.trim().length > 0;
  const hasImage = typeof this.imageURL === 'string' && this.imageURL.trim().length > 0;

  if (!hasContent && !hasImage) {
    return next(new Error('A report must include text or an image.'));
  }

  if (!hasContent) {
    this.content = undefined;
  }

  return next();
});

module.exports = mongoose.model('Comment', commentSchema);
