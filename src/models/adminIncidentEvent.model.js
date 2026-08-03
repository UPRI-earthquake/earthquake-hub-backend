const mongoose = require('mongoose');
const {
  getIncidentRetentionConfig,
  resolveIncidentEventRetention,
} = require('../config/incidentRetention.config');

const INCIDENT_EVENT_TYPES = [
  'detected',
  'reopened',
  'acknowledged',
  'investigating',
  'resolved',
  'assigned',
  'unassigned',
  'note',
];

const adminIncidentEventSchema = new mongoose.Schema(
  {
    incidentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AdminIncident',
      required: true,
      index: true,
    },
    eventType: {
      type: String,
      enum: INCIDENT_EVENT_TYPES,
      required: true,
      index: true,
    },
    correlationId: {
      type: String,
      trim: true,
      maxlength: 128,
      index: true,
    },
    actor: {
      accountId: { type: String, trim: true, maxlength: 128 },
      username: { type: String, trim: true, maxlength: 254 },
      role: { type: String, trim: true, maxlength: 64 },
    },
    fromStatus: { type: String, trim: true, maxlength: 32 },
    toStatus: { type: String, trim: true, maxlength: 32 },
    assignedTo: { type: String, trim: true, maxlength: 254 },
    reason: { type: String, trim: true, maxlength: 1000 },
    sourceEvidence: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    retentionDays: {
      type: Number,
      min: 0,
      max: 3650,
      default: () => getIncidentRetentionConfig().eventDays,
    },
    expiresAt: {
      type: Date,
      default: () => resolveIncidentEventRetention().expiresAt,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

adminIncidentEventSchema.index({ incidentId: 1, createdAt: -1, _id: -1 });
adminIncidentEventSchema.index({ incidentId: 1, correlationId: 1 });
adminIncidentEventSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Incident history is append-only. Corrections are represented by another
// event so operators can reconstruct the complete lifecycle.
[
  'deleteMany',
  'deleteOne',
  'findOneAndDelete',
  'findOneAndReplace',
  'findOneAndUpdate',
  'replaceOne',
  'updateMany',
  'updateOne',
].forEach((operation) => {
  adminIncidentEventSchema.pre(operation, function rejectMutation() {
    throw new Error('AdminIncidentEvent records are immutable. Append a new event instead.');
  });
});

const AdminIncidentEvent = mongoose.model('AdminIncidentEvent', adminIncidentEventSchema);
AdminIncidentEvent.INCIDENT_EVENT_TYPES = INCIDENT_EVENT_TYPES;

module.exports = AdminIncidentEvent;
