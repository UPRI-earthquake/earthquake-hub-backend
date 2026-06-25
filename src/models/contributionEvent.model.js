const mongoose = require('mongoose');

const CONTRIBUTION_ACTION_TYPES = [
  'report_posted',
  'image_report_posted',
  'report_marked_helpful',
  'report_received_helpful',
  'report_issue_submitted',
];

const CONTRIBUTION_TARGET_TYPES = ['comment', 'event'];

const contributionEventSchema = new mongoose.Schema(
  {
    dedupeKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
      index: true,
    },
    actionType: {
      type: String,
      enum: CONTRIBUTION_ACTION_TYPES,
      required: true,
      index: true,
    },
    targetType: {
      type: String,
      enum: CONTRIBUTION_TARGET_TYPES,
      required: true,
      default: 'comment',
    },
    targetId: {
      type: String,
      trim: true,
      index: true,
    },
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Event',
      index: true,
    },
    eventPublicID: {
      type: String,
      trim: true,
      index: true,
    },
    points: {
      type: Number,
      required: true,
      default: 0,
    },
    reason: {
      type: String,
      trim: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
  },
);

contributionEventSchema.index({ accountId: 1, createdAt: -1 });
contributionEventSchema.index({ eventId: 1, createdAt: -1 });
contributionEventSchema.index({ eventPublicID: 1, createdAt: -1 });

const ContributionEvent = mongoose.model('ContributionEvent', contributionEventSchema);
ContributionEvent.CONTRIBUTION_ACTION_TYPES = CONTRIBUTION_ACTION_TYPES;
ContributionEvent.CONTRIBUTION_TARGET_TYPES = CONTRIBUTION_TARGET_TYPES;

module.exports = ContributionEvent;
