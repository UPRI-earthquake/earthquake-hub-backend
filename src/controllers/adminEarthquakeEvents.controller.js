const crypto = require('crypto');
const Joi = require('joi');
const EQEventsService = require('../services/EQevents.service');
const AdminJobService = require('../services/adminJob.service');
const AuditLogService = require('../services/auditLog.service');
const {
  actor,
  idempotencyKeySchema,
  publicJob,
  sendKnownJobError,
} = require('./adminJob.controller');
const { responseCodes } = require('./responseCodes');

const queueSchema = Joi.object({
  startTime: Joi.date().iso().optional(),
  endTime: Joi.date().iso().min(Joi.ref('startTime')).optional(),
  hasSummary: Joi.boolean().truthy('true').falsy('false').optional(),
  pendingEnrichment: Joi.boolean().truthy('true').falsy('false').optional(),
  minMagnitude: Joi.number().min(-10).max(20).optional(),
  recordingAttention: Joi.boolean().truthy('true').falsy('false').optional(),
  recordingStatus: Joi.string().valid('pending', 'partial', 'verified', 'unavailable').optional(),
  sourceCatalog: Joi.string().trim().max(100).optional(),
  summaryReviewStatus: Joi.string().valid('none', 'draft', 'needs_review', 'approved').optional(),
  search: Joi.string().trim().max(100).allow('').optional(),
  limit: Joi.number().integer().min(1).max(100).default(25),
  offset: Joi.number().integer().min(0).default(0),
});

const summarySchema = Joi.object({
  publicID: Joi.string().trim().min(1).max(256).required(),
  text: Joi.string().trim().min(1).max(5000).required(),
  reason: Joi.string().trim().min(3).max(1000).required(),
});

const actionSchema = Joi.object({
  reason: Joi.string().trim().min(3).max(1000).required(),
});
const summaryReviewSchema = actionSchema.keys({
  publicID: Joi.string().trim().min(1).max(256).required(),
  currentStatus: Joi.string().valid('draft', 'needs_review', 'approved').required(),
  status: Joi.string().valid('draft', 'needs_review', 'approved').required(),
});
const jobActionSchema = actionSchema.keys({
  idempotencyKey: idempotencyKeySchema,
});

function requestIdempotencyKey(req, legacyPrefix) {
  return req.get('Idempotency-Key')
    || (req.baseUrl === '/eq-events' ? `${legacyPrefix}:${crypto.randomUUID()}` : undefined);
}

exports.listEvents = async (req, res, next) => {
  try {
    const { error, value } = queueSchema.validate(req.query, { stripUnknown: true });
    if (error) throw error;
    const result = await EQEventsService.getAdminEventQueue({ ...value, includeSummary: true });
    res.status(200).json({
      status: responseCodes.GENERIC_SUCCESS,
      message: 'Earthquake events retrieved successfully.',
      payload: result.events,
      pagination: { total: result.total, limit: result.limit, offset: result.offset },
      summary: result.summary,
    });
    res.message = 'Earthquake events retrieved successfully.';
  } catch (error) {
    next(error);
  }
};

exports.updateSummary = async (req, res, next) => {
  try {
    const { error, value } = summarySchema.validate({ ...req.params, ...req.body }, { stripUnknown: true });
    if (error) throw error;
    const updated = await AuditLogService.execute(req, {
      eventType: 'earthquake_event.summary.update',
      target: { type: 'earthquake_event', id: value.publicID, label: value.publicID },
      reason: value.reason,
      metadata: { reviewStatus: 'draft', summaryLength: value.text.length },
    }, () => EQEventsService.setEventSummary(value.publicID, value.text, req.username || 'admin'));
    res.status(200).json({ status: responseCodes.GENERIC_SUCCESS, message: 'Event summary updated successfully.', payload: updated.summaryOverride });
    res.message = 'Event summary updated successfully.';
  } catch (error) {
    next(error);
  }
};

exports.revertSummary = async (req, res, next) => {
  try {
    const { error, value } = Joi.object({ publicID: Joi.string().trim().min(1).max(256).required(), reason: Joi.string().trim().min(3).max(1000).required() })
      .validate({ ...req.params, ...req.body }, { stripUnknown: true });
    if (error) throw error;
    await AuditLogService.execute(req, {
      eventType: 'earthquake_event.summary.revert',
      target: { type: 'earthquake_event', id: value.publicID, label: value.publicID },
      reason: value.reason,
    }, () => EQEventsService.clearEventSummary(value.publicID));
    res.status(200).json({ status: responseCodes.GENERIC_SUCCESS, message: 'Event summary reverted to auto-generated.' });
    res.message = 'Event summary reverted to auto-generated.';
  } catch (error) {
    next(error);
  }
};

exports.transitionSummaryReview = async (req, res, next) => {
  try {
    const { error, value } = summaryReviewSchema.validate(
      { ...req.params, ...req.body },
      { stripUnknown: true },
    );
    if (error) throw error;
    const transitionName = `${value.currentStatus}.to.${value.status}`;
    const updated = await AuditLogService.execute(req, {
      eventType: `earthquake_event.summary.review.${transitionName}`,
      target: { type: 'earthquake_event', id: value.publicID, label: value.publicID },
      reason: value.reason,
      metadata: {
        fromStatus: value.currentStatus,
        toStatus: value.status,
      },
    }, () => EQEventsService.transitionEventSummaryReview(
      value.publicID,
      value.currentStatus,
      value.status,
      req.username || 'admin',
    ));
    res.status(200).json({
      status: responseCodes.GENERIC_SUCCESS,
      message: 'Event summary review state updated successfully.',
      payload: updated.summaryOverride,
    });
    res.message = 'Event summary review state updated successfully.';
  } catch (error) {
    next(error);
  }
};

exports.runEnrichment = async (req, res, next) => {
  try {
    const { error, value } = jobActionSchema.validate({
      ...req.body,
      idempotencyKey: requestIdempotencyKey(req, 'legacy-enrichment'),
    }, { stripUnknown: true });
    if (error) throw error;
    const result = await AuditLogService.execute(req, {
      eventType: 'earthquake_event.enrichment.run',
      target: { type: 'earthquake_event_queue', id: 'pending-enrichment', label: 'Pending catalog enrichment' },
      reason: value.reason,
    }, ({ correlationId }) => AdminJobService.enqueue({
      correlationId,
      idempotencyKey: value.idempotencyKey,
      jobType: 'earthquake-event-enrichment',
      reason: value.reason,
      requestedBy: actor(req),
      target: {
        type: 'earthquake_event_queue',
        id: 'pending-enrichment',
        label: 'Pending catalog enrichment',
      },
    }));
    AdminJobService.wake();
    const responseStatus = result.reused || req.baseUrl === '/eq-events' ? 200 : 202;
    res.status(responseStatus).json({
      status: responseCodes.GENERIC_SUCCESS,
      message: result.reused
        ? 'The existing catalog enrichment request was returned.'
        : 'Catalog enrichment queued successfully.',
      payload: publicJob(result.job),
      reused: result.reused,
    });
    res.message = 'Catalog enrichment queued successfully.';
  } catch (error) {
    if (!sendKnownJobError(res, error)) next(error);
  }
};

exports.refreshRecordingAvailability = async (req, res, next) => {
  try {
    const { error, value } = jobActionSchema.validate({
      ...req.body,
      idempotencyKey: requestIdempotencyKey(req, 'legacy-recording'),
    }, { stripUnknown: true });
    if (error) throw error;
    const result = await AuditLogService.execute(req, {
      eventType: 'earthquake_event.recording_availability.refresh',
      target: {
        type: 'earthquake_event_queue',
        id: 'recording-availability',
        label: 'Recording availability',
      },
      reason: value.reason,
    }, ({ correlationId }) => AdminJobService.enqueue({
      correlationId,
      idempotencyKey: value.idempotencyKey,
      jobType: 'earthquake-recording-availability-refresh',
      reason: value.reason,
      requestedBy: actor(req),
      target: {
        type: 'earthquake_event_queue',
        id: 'recording-availability',
        label: 'Recording availability',
      },
    }));
    AdminJobService.wake();
    const responseStatus = result.reused || req.baseUrl === '/eq-events' ? 200 : 202;
    res.status(responseStatus).json({
      status: responseCodes.GENERIC_SUCCESS,
      message: result.reused
        ? 'The existing recording verification request was returned.'
        : 'Recording verification queued successfully.',
      payload: publicJob(result.job),
      reused: result.reused,
    });
    res.message = 'Recording verification queued successfully.';
  } catch (error) {
    if (!sendKnownJobError(res, error)) next(error);
  }
};
