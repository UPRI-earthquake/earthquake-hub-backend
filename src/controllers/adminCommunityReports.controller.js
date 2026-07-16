const Joi = require('joi');
const CommentsService = require('../services/comments.service');
const AuditLogService = require('../services/auditLog.service');
const { responseCodes } = require('./responseCodes');

const queueSchema = Joi.object({
  status: Joi.string().valid(...Object.values(CommentsService.COMMENT_STATUS)).optional(),
  hasImage: Joi.boolean().truthy('true').falsy('false').optional(),
  hasIssues: Joi.boolean().truthy('true').falsy('false').optional(),
  search: Joi.string().trim().max(100).allow('').optional(),
  limit: Joi.number().integer().min(1).max(100).default(25),
  offset: Joi.number().integer().min(0).default(0),
});

const moderationSchema = Joi.object({
  commentId: Joi.string().trim().required(),
  status: Joi.string().valid(...Object.values(CommentsService.COMMENT_STATUS)).required(),
  reason: Joi.string().trim().min(3).max(1000).required(),
});

const deletionSchema = Joi.object({
  commentId: Joi.string().trim().required(),
  reason: Joi.string().trim().min(3).max(1000).required(),
});

exports.listCommunityReports = async (req, res, next) => {
  try {
    const { error, value } = queueSchema.validate(req.query, { stripUnknown: true });
    if (error) throw error;
    const result = await CommentsService.getAdminModerationQueue(value);
    res.status(200).json({
      status: responseCodes.GENERIC_SUCCESS,
      message: 'Community reports retrieved successfully.',
      payload: result.comments,
      pagination: { total: result.total, limit: result.limit, offset: result.offset },
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
    const report = await AuditLogService.execute(req, {
      eventType: `community_report.status.${value.status}`,
      target: { type: 'community_report', id: value.commentId, label: value.commentId },
      reason: value.reason,
    }, () => CommentsService.updateCommentStatus(value.commentId, value.status, req.username || 'admin'));
    if (!report) {
      res.status(404).json({ status: responseCodes.GENERIC_ERROR, message: 'Community report not found.' });
      return;
    }
    res.status(200).json({ status: responseCodes.GENERIC_SUCCESS, message: 'Community report status updated successfully.', payload: report });
    res.message = 'Community report status updated successfully.';
  } catch (error) {
    next(error);
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
