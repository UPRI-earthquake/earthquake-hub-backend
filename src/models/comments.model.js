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
 *           userId:
 *             type: string
 *             description: Reference to the Account ObjectId
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
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',  // Assuming 'Account' from account.model.js; adjust if needed
      required: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,  // Optional: Limit length to prevent abuse
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

// Pre-save hook to generate commentId if not provided
commentSchema.pre('save', function (next) {
  if (!this.commentId) {
    this.commentId = randomUUID();
  }
  next();
});

// Indexes for performance (e.g., querying comments by event or user)
commentSchema.index({ eventId: 1, createdAt: -1 });  // Sort comments by event and recency
commentSchema.index({ userId: 1 });
commentSchema.index({ commentId: 1 }, { unique: true });

module.exports = mongoose.model('Comment', commentSchema);