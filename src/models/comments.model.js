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
 *           eventPublicID:
 *             type: string
 *             description: Stable SeisComP publicID for the referenced event
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
 *           status:
 *             type: string
 *             enum: [pending, approved, rejected]
 *             description: Moderation status for public display
 *           createdAt:
 *             type: string
 *             format: date-time
 *           updatedAt:
 *             type: string
 *             format: date-time
 */

const mongoose = require('mongoose');
const { randomUUID } = require('crypto');

const COMMENT_STATUSES = ['pending', 'approved', 'rejected'];
const COMMENT_ISSUE_REASONS = ['duplicate', 'unclear', 'wrong_location', 'not_related', 'inappropriate'];
const MODERATION_CASE_STATUSES = ['open', 'investigating', 'escalated', 'resolved'];
const MODERATION_CASE_EVENT_TYPES = ['opened', 'investigating', 'escalated', 'resolved', 'reopened', 'decision', 'note'];

const moderationCaseHistorySchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, trim: true, maxlength: 64 },
    eventType: { type: String, enum: MODERATION_CASE_EVENT_TYPES, required: true },
    correlationId: { type: String, trim: true, maxlength: 128 },
    actor: {
      accountId: { type: String, trim: true, maxlength: 128 },
      username: { type: String, trim: true, maxlength: 254 },
      role: { type: String, trim: true, maxlength: 64 },
    },
    fromStatus: { type: String, enum: MODERATION_CASE_STATUSES },
    toStatus: { type: String, enum: MODERATION_CASE_STATUSES },
    fromReportStatus: { type: String, enum: COMMENT_STATUSES },
    toReportStatus: { type: String, enum: COMMENT_STATUSES },
    reason: { type: String, required: true, trim: true, maxlength: 1000 },
    createdAt: { type: Date, required: true, default: Date.now },
  },
  { _id: false },
);

const moderationCaseSchema = new mongoose.Schema(
  {
    status: { type: String, enum: MODERATION_CASE_STATUSES, required: true },
    version: { type: Number, required: true, min: 1 },
    historyCount: { type: Number, required: true, min: 1 },
    updatedAt: { type: Date, required: true },
    updatedBy: { type: String, trim: true, maxlength: 254 },
    resolvedAt: Date,
    history: { type: [moderationCaseHistorySchema], default: [] },
  },
  { _id: false },
);

// Comments model: Simple display-only comments on events.
// Helpful marks are public counts; issue reports are private moderation signals.
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
    eventPublicID: {
      type: String,
      trim: true,
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
    status: {
      type: String,
      enum: COMMENT_STATUSES,
      default: 'approved',
      index: true,
    },
    moderatedBy: {
      type: String,
      trim: true,
    },
    moderatedAt: {
      type: Date,
    },
    moderationCase: { type: moderationCaseSchema, default: null },
    helpfulAccountIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
    }],
    issueReports: [{
      accountId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Account',
        required: true,
      },
      reason: {
        type: String,
        enum: COMMENT_ISSUE_REASONS,
        required: true,
      },
      createdAt: {
        type: Date,
        default: Date.now,
      },
    }],
  },
  {
    timestamps: true,  // Adds createdAt and updatedAt automatically
  },
);

// Indexes for performance (e.g., querying comments by event or user)
commentSchema.index({ eventId: 1, status: 1, createdAt: -1, commentId: -1 });  // Sort visible comments by event and recency
commentSchema.index({ eventPublicID: 1, status: 1, createdAt: -1, commentId: -1 });
commentSchema.index({ username: 1 });
commentSchema.index({ accountId: 1 });
commentSchema.index({ helpfulAccountIds: 1 });
commentSchema.index({ 'issueReports.accountId': 1 });
commentSchema.index({ 'moderationCase.status': 1, updatedAt: -1 });

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

const Comment = mongoose.model('Comment', commentSchema);
Comment.COMMENT_ISSUE_REASONS = COMMENT_ISSUE_REASONS;
Comment.MODERATION_CASE_STATUSES = MODERATION_CASE_STATUSES;
Comment.MODERATION_CASE_EVENT_TYPES = MODERATION_CASE_EVENT_TYPES;

module.exports = Comment;
