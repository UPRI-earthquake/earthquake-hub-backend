const Joi = require('joi');
const AuditLogService = require('../services/auditLog.service');
const { responseCodes } = require('./responseCodes');

const listSchema = Joi.object({
  eventType: Joi.string().trim().max(128).optional(),
  targetType: Joi.string().trim().max(64).optional(),
  outcome: Joi.string().valid('started', 'succeeded', 'failed', 'rejected').optional(),
  actor: Joi.string().trim().max(128).optional(),
  from: Joi.date().iso().optional(),
  to: Joi.date().iso().min(Joi.ref('from')).optional(),
  limit: Joi.number().integer().min(1).max(100).default(25),
  offset: Joi.number().integer().min(0).default(0),
});

exports.listAuditLogs = async (req, res, next) => {
  try {
    const { error, value } = listSchema.validate(req.query, { stripUnknown: true });
    if (error) throw error;
    const filters = {};
    if (value.eventType) filters.eventType = value.eventType;
    if (value.targetType) filters['target.type'] = value.targetType;
    if (value.outcome) filters.outcome = value.outcome;
    if (value.actor) filters['actor.username'] = value.actor;
    if (value.from || value.to) {
      filters.createdAt = {};
      if (value.from) filters.createdAt.$gte = value.from;
      if (value.to) filters.createdAt.$lte = value.to;
    }
    const result = await AuditLogService.list(filters, value);
    res.status(200).json({
      status: responseCodes.GENERIC_SUCCESS,
      message: 'Audit logs retrieved successfully.',
      payload: result.logs,
      pagination: { total: result.total, limit: result.limit, offset: result.offset },
    });
    res.message = 'Audit logs retrieved successfully.';
  } catch (error) {
    next(error);
  }
};
