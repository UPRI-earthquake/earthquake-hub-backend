const Joi = require('joi');
const AuditLogService = require('../services/auditLog.service');
const { responseCodes } = require('./responseCodes');

const listSchema = Joi.object({
  correlationId: Joi.string().trim().max(128).optional(),
  eventType: Joi.string().trim().max(128).optional(),
  targetId: Joi.string().trim().max(512).optional(),
  targetType: Joi.string().trim().max(64).optional(),
  outcome: Joi.string().valid('started', 'succeeded', 'failed', 'rejected').optional(),
  actor: Joi.string().trim().max(128).optional(),
  from: Joi.date().iso().optional(),
  to: Joi.date().iso().min(Joi.ref('from')).optional(),
  cursor: Joi.string().trim().max(512).optional(),
  limit: Joi.number().integer().min(1).max(100).default(25),
  offset: Joi.number().integer().min(0).default(0),
});

exports.listAuditLogs = async (req, res, next) => {
  try {
    const { error, value } = listSchema.validate(req.query, { stripUnknown: true });
    if (error) throw error;
    const filters = {};
    if (value.correlationId) filters.correlationId = value.correlationId;
    if (value.eventType) filters.eventType = value.eventType;
    if (value.targetId) filters['target.id'] = value.targetId;
    if (value.targetType) filters['target.type'] = value.targetType;
    if (value.outcome) filters.outcome = value.outcome;
    if (value.actor) filters['actor.username'] = value.actor;
    if (value.from || value.to) {
      filters.createdAt = {};
      if (value.from) filters.createdAt.$gte = value.from;
      if (value.to) filters.createdAt.$lte = value.to;
    }
    const result = await AuditLogService.list(filters, value);
    await AuditLogService.record(req, {
      eventType: 'admin.audit.read',
      outcome: 'succeeded',
      target: { type: 'audit_collection', id: 'auditlogs', label: 'Admin audit logs' },
      metadata: {
        filterFields: Object.keys(filters),
        resultCount: result.logs.length,
        paginationMode: value.cursor ? 'cursor' : 'offset',
      },
    });
    res.status(200).json({
      status: responseCodes.GENERIC_SUCCESS,
      message: 'Audit logs retrieved successfully.',
      payload: result.logs,
      pagination: {
        total: result.total,
        limit: result.limit,
        offset: result.offset,
        nextCursor: result.nextCursor,
      },
      summary: result.summary,
    });
    res.message = 'Audit logs retrieved successfully.';
  } catch (error) {
    next(error);
  }
};
