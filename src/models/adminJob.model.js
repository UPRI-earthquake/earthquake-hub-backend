const mongoose = require('mongoose');

const ADMIN_JOB_TYPES = [
  'earthquake-event-enrichment',
  'earthquake-recording-availability-refresh',
];
const ADMIN_JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'timed_out'];

const adminJobSchema = new mongoose.Schema(
  {
    jobType: {
      type: String,
      enum: ADMIN_JOB_TYPES,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ADMIN_JOB_STATUSES,
      required: true,
      default: 'queued',
      index: true,
    },
    // Set to jobType only while queued/running. The sparse unique index makes
    // duplicate active work impossible even across multiple backend replicas.
    activeKey: {
      type: String,
      trim: true,
      maxlength: 128,
    },
    idempotencyKey: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128,
    },
    correlationId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128,
      index: true,
    },
    requestedBy: {
      accountId: { type: String, trim: true, maxlength: 128 },
      username: { type: String, required: true, trim: true, maxlength: 254 },
      adminRole: { type: String, trim: true, maxlength: 64 },
    },
    reason: { type: String, required: true, trim: true, maxlength: 1000 },
    target: {
      type: { type: String, required: true, trim: true, maxlength: 64 },
      id: { type: String, required: true, trim: true, maxlength: 512 },
      label: { type: String, trim: true, maxlength: 512 },
    },
    attempt: { type: Number, required: true, default: 1, min: 1, max: 10 },
    retryOf: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminJob' },
    rootJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminJob', index: true },
    progress: {
      current: { type: Number, default: 0, min: 0 },
      total: { type: Number, min: 0 },
      percent: { type: Number, default: 0, min: 0, max: 100 },
      message: { type: String, trim: true, maxlength: 512 },
      updatedAt: Date,
    },
    result: { type: mongoose.Schema.Types.Mixed },
    error: {
      code: { type: String, trim: true, maxlength: 128 },
      message: { type: String, trim: true, maxlength: 1024 },
      retryable: { type: Boolean, default: false },
    },
    timeoutAt: { type: Date, required: true, index: true },
    lease: {
      owner: { type: String, trim: true, maxlength: 256 },
      expiresAt: Date,
    },
    startedAt: Date,
    finishedAt: Date,
    retentionDays: { type: Number, min: 0, max: 3650 },
    expiresAt: Date,
  },
  { timestamps: true },
);

adminJobSchema.index({ jobType: 1, idempotencyKey: 1 }, { unique: true });
adminJobSchema.index({ activeKey: 1 }, { unique: true, sparse: true });
adminJobSchema.index({ jobType: 1, createdAt: -1, _id: -1 });
adminJobSchema.index({ status: 1, createdAt: 1, _id: 1 });
adminJobSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const AdminJob = mongoose.model('AdminJob', adminJobSchema);
AdminJob.ADMIN_JOB_TYPES = ADMIN_JOB_TYPES;
AdminJob.ADMIN_JOB_STATUSES = ADMIN_JOB_STATUSES;

module.exports = AdminJob;
