const mongoose = require('mongoose');

const AUDIT_OUTCOMES = ['started', 'succeeded', 'failed', 'rejected'];

const auditLogSchema = new mongoose.Schema(
  {
    correlationId: { type: String, required: true, index: true, trim: true, maxlength: 128 },
    eventType: {
      type: String,
      required: true,
      trim: true,
      match: /^[a-z][a-z0-9._-]{2,127}$/,
      index: true,
    },
    outcome: { type: String, enum: AUDIT_OUTCOMES, required: true, index: true },
    actor: {
      accountId: { type: String, trim: true, index: true, maxlength: 128 },
      username: { type: String, trim: true, index: true, maxlength: 254 },
      role: { type: String, trim: true, maxlength: 64 },
    },
    target: {
      type: { type: String, required: true, trim: true, index: true, maxlength: 64 },
      id: { type: String, required: true, trim: true, index: true, maxlength: 512 },
      label: { type: String, trim: true, maxlength: 512 },
    },
    reason: { type: String, trim: true, maxlength: 1000 },
    request: {
      method: { type: String, trim: true, maxlength: 16 },
      path: { type: String, trim: true, maxlength: 2048 },
      ip: { type: String, trim: true, maxlength: 64 },
      requestId: { type: String, trim: true, maxlength: 128 },
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    retentionClass: {
      type: String,
      enum: ['routine_telemetry', 'administrative'],
      required: true,
      index: true,
    },
    expiresAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ createdAt: -1, _id: -1 });
auditLogSchema.index({ eventType: 1, createdAt: -1 });
auditLogSchema.index({ 'target.type': 1, 'target.id': 1, createdAt: -1 });
auditLogSchema.index({ 'actor.username': 1, createdAt: -1 });
// MongoDB's TTL monitor removes each record after its policy-specific date.
// Application mutation hooks below do not run for database-managed TTL expiry.
auditLogSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Audit lifecycle changes are represented by additional documents sharing a
// correlation ID. Application code must never revise or erase prior events.
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
  auditLogSchema.pre(operation, function rejectMutation() {
    throw new Error('AuditLog records are immutable. Append a new lifecycle event instead.');
  });
});

const AuditLog = mongoose.model('AuditLog', auditLogSchema);
AuditLog.AUDIT_OUTCOMES = AUDIT_OUTCOMES;

module.exports = AuditLog;
