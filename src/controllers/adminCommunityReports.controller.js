const Joi = require('joi');
const CommentsService = require('../services/comments.service');
const AuditLogService = require('../services/auditLog.service');
const { responseCodes } = require('./responseCodes');

const queueSchema = Joi.object({
  status: Joi.string().valid(...Object.values(CommentsService.COMMENT_STATUS)).optional(),
  caseStatus: Joi.string().valid('active', ...CommentsService.MODERATION_CASE_STATUSES).optional(),
  hasImage: Joi.boolean().truthy('true').falsy('false').optional(),
  hasIssues: Joi.boolean().truthy('true').falsy('false').optional(),
  startTime: Joi.date().iso().optional(),
  endTime: Joi.date().iso().min(Joi.ref('startTime')).optional(),
  search: Joi.string().trim().max(100).allow('').optional(),
  limit: Joi.number().integer().min(1).max(100).default(25),
  offset: Joi.number().integer().min(0).default(0),
});

const moderationSchema = Joi.object({
  commentId: Joi.string().trim().required(),
  currentStatus: Joi.string().valid(...Object.values(CommentsService.COMMENT_STATUS)).required(),
  currentCaseStatus: Joi.string().valid(...CommentsService.MODERATION_CASE_STATUSES).required(),
  currentCaseVersion: Joi.number().integer().min(0).required(),
  status: Joi.string().valid(...Object.values(CommentsService.COMMENT_STATUS)).required(),
  reason: Joi.string().trim().min(3).max(1000).required(),
});
const caseTransitionSchema = Joi.object({
  commentId: Joi.string().trim().required(),
  currentStatus: Joi.string().valid(...CommentsService.MODERATION_CASE_STATUSES).required(),
  currentVersion: Joi.number().integer().min(0).required(),
  status: Joi.string().valid(...CommentsService.MODERATION_CASE_STATUSES).required(),
  reason: Joi.string().trim().min(3).max(1000).required(),
});
const caseNoteSchema = Joi.object({
  commentId: Joi.string().trim().required(),
  currentStatus: Joi.string().valid(...CommentsService.MODERATION_CASE_STATUSES).required(),
  currentVersion: Joi.number().integer().min(0).required(),
  reason: Joi.string().trim().min(3).max(1000).required(),
});

const deletionSchema = Joi.object({
  commentId: Joi.string().trim().required(),
  reason: Joi.string().trim().min(3).max(1000).required(),
});

function actor(req) {
  return {
    accountId: req.accountId,
    username: req.username || 'admin',
    role: req.adminRole || req.role,
  };
}

function assertCaseResult(result) {
  if (result.notFound) {
    throw Object.assign(new Error('Community report not found.'), {
      code: 'ADMIN_MODERATION_CASE_NOT_FOUND', statusCode: 404,
    });
  }
  if (result.invalidStatus) {
    throw Object.assign(new Error('Community report status is invalid.'), {
      code: 'ADMIN_MODERATION_STATUS_INVALID', statusCode: 400,
    });
  }
  if (result.error === 'invalidTransition') {
    throw Object.assign(new Error(`Moderation case cannot transition from ${result.fromStatus} to ${result.toStatus}.`), {
      code: 'ADMIN_MODERATION_CASE_INVALID_TRANSITION', statusCode: 409,
    });
  }
  if (result.error === 'conflict') {
    throw Object.assign(new Error(result.message), {
      code: 'ADMIN_MODERATION_CASE_CONFLICT', statusCode: 409,
    });
  }
  return result;
}

function sendKnownCaseError(res, error) {
  if (!error?.code?.startsWith('ADMIN_MODERATION_')) return false;
  res.status(error.statusCode || 409).json({
    status: responseCodes.GENERIC_ERROR,
    errorCode: error.code,
    retryable: false,
    message: error.message,
  });
  return true;
}

exports.listCommunityReports = async (req, res, next) => {
  try {
    const { error, value } = queueSchema.validate(req.query, { stripUnknown: true });
    if (error) throw error;
    const result = await CommentsService.getAdminModerationQueue({ ...value, includeSummary: true });
    res.status(200).json({
      status: responseCodes.GENERIC_SUCCESS,
      message: 'Community reports retrieved successfully.',
      payload: result.comments,
      pagination: { total: result.total, limit: result.limit, offset: result.offset },
      summary: result.summary,
    });
    res.message = 'Community reports retrieved successfully.';
  } catch (error) {
    next(error);
  }
};

exports.updateCommunityReportStatus = async (req, res, next) => {
  try {
    const { error, value } = moderationSchema.validate({ ...req.params, ...req.body }, { stripUnknown: true });
    if (error) throw error;
    const result = await AuditLogService.execute(req, {
      eventType: `community_report.status.${value.status}`,
      target: { type: 'community_report', id: value.commentId, label: value.commentId },
      reason: value.reason,
      metadata: {
        currentCaseStatus: value.currentCaseStatus,
        currentCaseVersion: value.currentCaseVersion,
        currentStatus: value.currentStatus,
        requestedStatus: value.status,
      },
    }, async ({ correlationId } = {}) => assertCaseResult(await CommentsService.moderateAdminComment(
      value.commentId, value, actor(req), correlationId,
    )));
    res.status(200).json({ status: responseCodes.GENERIC_SUCCESS, message: 'Community report status updated successfully.', payload: result });
    res.message = 'Community report status updated successfully.';
  } catch (error) {
    if (!sendKnownCaseError(res, error)) next(error);
  }
};

exports.getModerationCase = async (req, res, next) => {
  try {
    const { error, value: commentId } = Joi.string().trim().required().validate(req.params.commentId);
    if (error) throw error;
    const result = assertCaseResult(await CommentsService.getModerationCase(commentId));
    res.status(200).json({
      status: responseCodes.GENERIC_SUCCESS,
      message: 'Moderation case retrieved successfully.',
      payload: result.moderationCase,
    });
    res.message = 'Moderation case retrieved successfully.';
  } catch (error) {
    if (!sendKnownCaseError(res, error)) next(error);
  }
};

exports.transitionModerationCase = async (req, res, next) => {
  try {
    const { error, value } = caseTransitionSchema.validate({ ...req.params, ...req.body }, { stripUnknown: true });
    if (error) throw error;
    const result = await AuditLogService.execute(req, {
      eventType: `community_report.case.${value.status}`,
      target: { type: 'community_report', id: value.commentId, label: value.commentId },
      reason: value.reason,
      metadata: { fromStatus: value.currentStatus, fromVersion: value.currentVersion, toStatus: value.status },
    }, async ({ correlationId } = {}) => assertCaseResult(await CommentsService.transitionModerationCase(
      value.commentId, value, actor(req), correlationId,
    )));
    res.status(200).json({ status: responseCodes.GENERIC_SUCCESS, message: 'Moderation case updated successfully.', payload: result });
    res.message = 'Moderation case updated successfully.';
  } catch (error) {
    if (!sendKnownCaseError(res, error)) next(error);
  }
};

exports.addModerationCaseNote = async (req, res, next) => {
  try {
    const { error, value } = caseNoteSchema.validate({ ...req.params, ...req.body }, { stripUnknown: true });
    if (error) throw error;
    const result = await AuditLogService.execute(req, {
      eventType: 'community_report.case.note',
      target: { type: 'community_report', id: value.commentId, label: value.commentId },
      reason: value.reason,
      metadata: { caseStatus: value.currentStatus, fromVersion: value.currentVersion },
    }, async ({ correlationId } = {}) => assertCaseResult(await CommentsService.addModerationCaseNote(
      value.commentId, value, actor(req), correlationId,
    )));
    res.status(200).json({ status: responseCodes.GENERIC_SUCCESS, message: 'Moderation case note added successfully.', payload: result });
    res.message = 'Moderation case note added successfully.';
  } catch (error) {
    if (!sendKnownCaseError(res, error)) next(error);
  }
};

exports.deleteCommunityReport = async (req, res, next) => {
  try {
    const { error, value } = deletionSchema.validate({ ...req.params, ...req.body }, { stripUnknown: true });
    if (error) throw error;
    const report = await AuditLogService.execute(req, {
      eventType: 'community_report.delete',
      target: { type: 'community_report', id: value.commentId, label: value.commentId },
      reason: value.reason,
    }, () => CommentsService.deleteComment(value.commentId));
    if (!report) {
      res.status(404).json({ status: responseCodes.GENERIC_ERROR, message: 'Community report not found.' });
      return;
    }
    res.status(200).json({ status: responseCodes.GENERIC_SUCCESS, message: 'Community report deleted successfully.' });
    res.message = 'Community report deleted successfully.';
  } catch (error) {
    next(error);
  }
};
