const Joi = require('joi');
const AdminJobService = require('../services/adminJob.service');
const AdminCapabilitiesService = require('../services/adminCapabilities.service');
const AuditLogService = require('../services/auditLog.service');
const { responseCodes } = require('./responseCodes');

const jobIdSchema = Joi.string().trim().hex().length(24).required();
const idempotencyKeySchema = Joi.string().trim().min(8).max(128).pattern(/^[A-Za-z0-9._:-]+$/).required();
const listSchema = Joi.object({
  jobType: Joi.string().valid(
    'earthquake-event-enrichment',
    'earthquake-recording-availability-refresh',
  ).optional(),
  status: Joi.string().valid('queued', 'running', 'succeeded', 'failed', 'timed_out').optional(),
  limit: Joi.number().integer().min(1).max(100).default(20),
  offset: Joi.number().integer().min(0).default(0),
});

const JOB_CAPABILITIES = Object.freeze({
  'earthquake-event-enrichment': AdminCapabilitiesService.ACTIONS.EARTHQUAKE_EVENT_ENRICHMENT,
  'earthquake-recording-availability-refresh': AdminCapabilitiesService.ACTIONS.EARTHQUAKE_EVENT_RECORDING_REFRESH,
});
const retrySchema = Joi.object({
  jobId: jobIdSchema,
  idempotencyKey: idempotencyKeySchema,
  reason: Joi.string().trim().min(3).max(1000).required(),
});

function actor(req) {
  return {
    accountId: req.accountId ? String(req.accountId) : undefined,
    username: req.username || 'admin',
    adminRole: req.adminRole || 'super_admin',
  };
}

function publicJob(value) {
  const job = typeof value?.toObject === 'function' ? value.toObject() : value;
  if (!job) return job;
  return {
    _id: job._id,
    jobType: job.jobType,
    status: job.status,
    correlationId: job.correlationId,
    requestedBy: job.requestedBy,
    reason: job.reason,
    target: job.target,
    attempt: job.attempt,
    retryOf: job.retryOf,
    rootJobId: job.rootJobId,
    progress: job.progress,
    result: job.result,
    error: job.error,
    timeoutAt: job.timeoutAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function sendKnownJobError(res, error) {
  if (!error?.code?.startsWith('ADMIN_JOB_')) return false;
  res.status(error.statusCode || 409).json({
    status: responseCodes.GENERIC_ERROR,
    errorCode: error.code,
    retryable: error.code === 'ADMIN_JOB_ALREADY_ACTIVE',
    message: error.message,
    ...(error.activeJob ? { payload: publicJob(error.activeJob) } : {}),
  });
  return true;
}

exports.listJobs = async (req, res, next) => {
  try {
    const { error, value } = listSchema.validate(req.query, { stripUnknown: true });
    if (error) throw error;
    const filters = {};
    if (value.jobType) filters.jobType = value.jobType;
    if (value.status) filters.status = value.status;
    const result = await AdminJobService.list(filters, value);
    res.status(200).json({
      status: responseCodes.GENERIC_SUCCESS,
      message: 'Administrative jobs retrieved successfully.',
      payload: result.jobs.map(publicJob),
      pagination: {
        total: result.total,
        limit: result.limit,
        offset: result.offset,
      },
    });
    res.message = 'Administrative jobs retrieved successfully.';
  } catch (error) {
    next(error);
  }
};

exports.getJob = async (req, res, next) => {
  try {
    const { error, value: jobId } = jobIdSchema.validate(req.params.jobId);
    if (error) throw error;
    const job = await AdminJobService.getById(jobId);
    if (!job) {
      throw Object.assign(new Error('Admin job not found.'), {
        code: 'ADMIN_JOB_NOT_FOUND',
        statusCode: 404,
      });
    }
    res.status(200).json({
      status: responseCodes.GENERIC_SUCCESS,
      message: 'Administrative job retrieved successfully.',
      payload: publicJob(job),
    });
    res.message = 'Administrative job retrieved successfully.';
  } catch (error) {
    if (!sendKnownJobError(res, error)) next(error);
  }
};

exports.retryJob = async (req, res, next) => {
  try {
    const { error, value } = retrySchema.validate({
      ...req.params,
      ...req.body,
      idempotencyKey: req.get('Idempotency-Key'),
    }, { stripUnknown: true });
    if (error) throw error;

    const originalJob = await AdminJobService.getById(value.jobId);
    if (!originalJob) {
      throw Object.assign(new Error('Admin job not found.'), {
        code: 'ADMIN_JOB_NOT_FOUND',
        statusCode: 404,
      });
    }
    const actionId = JOB_CAPABILITIES[originalJob.jobType];
    const capability = actionId
      ? AdminCapabilitiesService.getCapability(actionId, req.adminRole || 'super_admin')
      : null;
    if (!capability?.enabled) {
      try {
        await AuditLogService.record(req, {
          eventType: 'admin.capability.rejected',
          outcome: 'rejected',
          target: { type: 'admin_job', id: value.jobId, label: value.jobId },
          reason: value.reason,
          metadata: {
            actionId: actionId || 'unmapped_admin_job',
            jobType: originalJob.jobType,
            reasonCode: 'capability_disabled',
          },
        });
      } catch (auditError) {
        console.error('Unable to record rejected admin job retry:', auditError?.message || auditError);
      }
      throw Object.assign(
        new Error(capability?.unavailableReason || 'This administrative job cannot be retried.'),
        { code: 'ADMIN_JOB_CAPABILITY_DISABLED', statusCode: 403 },
      );
    }

    const result = await AuditLogService.execute(req, {
      eventType: 'admin_job.retry',
      target: { type: 'admin_job', id: value.jobId, label: value.jobId },
      reason: value.reason,
    }, ({ correlationId }) => AdminJobService.retry(value.jobId, {
      correlationId,
      idempotencyKey: value.idempotencyKey,
      reason: value.reason,
      requestedBy: actor(req),
    }));
    AdminJobService.wake();
    res.status(result.reused ? 200 : 202).json({
      status: responseCodes.GENERIC_SUCCESS,
      message: result.reused
        ? 'The existing retry request was returned.'
        : 'Administrative job retry queued successfully.',
      payload: publicJob(result.job),
      reused: result.reused,
    });
    res.message = 'Administrative job retry queued successfully.';
  } catch (error) {
    if (!sendKnownJobError(res, error)) next(error);
  }
};

exports.actor = actor;
exports.idempotencyKeySchema = idempotencyKeySchema;
exports.JOB_CAPABILITIES = JOB_CAPABILITIES;
exports.publicJob = publicJob;
exports.sendKnownJobError = sendKnownJobError;
