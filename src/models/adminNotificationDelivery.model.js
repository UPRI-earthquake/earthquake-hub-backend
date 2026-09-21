const mongoose = require('mongoose');

const adminNotificationDeliverySchema = new mongoose.Schema({
  ruleKey: { type: String, required: true, index: true, maxlength: 96 },
  incidentId: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminIncident', required: true, index: true },
  incidentEventType: { type: String, required: true, maxlength: 32 },
  recipient: {
    accountId: { type: String, required: true, index: true, maxlength: 128 },
    email: { type: String, required: true, maxlength: 254 },
  },
  status: { type: String, required: true, enum: ['pending', 'sent', 'failed', 'suppressed'], index: true },
  dedupeKey: { type: String, required: true, unique: true, maxlength: 512 },
  condition: {
    sourceId: { type: String, maxlength: 256 },
    title: { type: String, maxlength: 512 },
    route: { type: String, maxlength: 512 },
  },
  attemptedAt: { type: Date, required: true, default: Date.now, index: true },
  completedAt: Date,
  providerMessageId: { type: String, maxlength: 512 },
  errorCode: { type: String, maxlength: 128 },
  errorMessage: { type: String, maxlength: 1000 },
}, { timestamps: true });

adminNotificationDeliverySchema.index({ ruleKey: 1, incidentId: 1, 'recipient.accountId': 1, completedAt: -1 });
adminNotificationDeliverySchema.index({ createdAt: -1, _id: -1 });

module.exports = mongoose.model('AdminNotificationDelivery', adminNotificationDeliverySchema);
