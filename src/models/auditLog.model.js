const mongoose = require('mongoose');

const AUDIT_OUTCOMES = ['started', 'succeeded', 'failed', 'rejected'];

const auditLogSchema = new mongoose.Schema(
  {
    correlationId: { type: String, required: true, index: true, trim: true },
    eventType: {
      type: String,
      required: true,
      trim: true,
      match: /^[a-z][a-z0-9._-]{2,127}$/,
      index: true,
    },
    outcome: { type: String, enum: AUDIT_OUTCOMES, required: true, index: true },
    actor: {
      accountId: { type: String, trim: true, index: true },
      username: { type: String, trim: true, index: true },
      role: { type: String, trim: true },
    },
    target: {
      type: { type: String, required: true, trim: true, index: true },
      id: { type: String, required: true, trim: true, index: true },
      label: { type: String, trim: true },
    },
    reason: { type: String, trim: true, maxlength: 1000 },
    request: {
      method: { type: String, trim: true },
      path: { type: String, trim: true },
      ip: { type: String, trim: true },
      requestId: { type: String, trim: true },
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ eventType: 1, createdAt: -1 });
auditLogSchema.index({ 'target.type': 1, 'target.id': 1, createdAt: -1 });
auditLogSchema.index({ 'actor.username': 1, createdAt: -1 });

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
