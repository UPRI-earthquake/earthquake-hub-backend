const mongoose = require('mongoose');

const INCIDENT_STATUSES = ['open', 'acknowledged', 'investigating', 'resolved'];
const INCIDENT_SEVERITIES = ['critical', 'warning', 'informational'];

const adminIncidentSchema = new mongoose.Schema(
  {
    fingerprint: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: 256,
    },
    origin: {
      type: String,
      enum: ['overview'],
      required: true,
      default: 'overview',
      index: true,
    },
    status: {
      type: String,
      enum: INCIDENT_STATUSES,
      required: true,
      default: 'open',
      index: true,
    },
    severity: {
      type: String,
      enum: INCIDENT_SEVERITIES,
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 512 },
    detail: { type: String, required: true, trim: true, maxlength: 2048 },
    subsystem: { type: String, required: true, trim: true, maxlength: 256 },
    route: { type: String, required: true, trim: true, maxlength: 512 },
    source: {
      type: { type: String, required: true, trim: true, maxlength: 64 },
      id: { type: String, required: true, trim: true, maxlength: 256 },
    },
    evidence: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    assignedTo: { type: String, trim: true, maxlength: 254, index: true },
    firstDetectedAt: { type: Date, required: true, index: true },
    lastObservedAt: { type: Date, required: true, index: true },
    acknowledgedAt: Date,
    investigatingAt: Date,
    resolvedAt: Date,
    recurrenceCount: { type: Number, default: 1, min: 1 },
    // Active incidents never expire. This field is assigned only when an
    // incident resolves and is removed if the condition reopens.
    retentionDays: {
      type: Number,
      min: 0,
      max: 3650,
    },
    expiresAt: Date,
  },
  { timestamps: true },
);

adminIncidentSchema.index({ status: 1, severity: 1, lastObservedAt: -1 });
adminIncidentSchema.index({ assignedTo: 1, status: 1, updatedAt: -1 });
adminIncidentSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const AdminIncident = mongoose.model('AdminIncident', adminIncidentSchema);
AdminIncident.INCIDENT_STATUSES = INCIDENT_STATUSES;
AdminIncident.INCIDENT_SEVERITIES = INCIDENT_SEVERITIES;

module.exports = AdminIncident;
