const Joi = require('joi');
const AdminIncidentService = require('../services/adminIncident.service');
const AdminOverviewService = require('../services/adminOverview.service');
const AuditLogService = require('../services/auditLog.service');
const { responseCodes } = require('./responseCodes');

const incidentIdSchema = Joi.string().trim().hex().length(24).required();
const listSchema = Joi.object({
  assignedTo: Joi.string().trim().max(254).optional(),
  severity: Joi.string().valid('critical', 'warning', 'informational').optional(),
  status: Joi.string().valid('open', 'acknowledged', 'investigating', 'resolved').optional(),
  limit: Joi.number().integer().min(1).max(100).default(50),
  offset: Joi.number().integer().min(0).default(0),
});
const updateSchema = Joi.object({
  incidentId: incidentIdSchema,
  status: Joi.string().valid('open', 'acknowledged', 'investigating', 'resolved').optional(),
  assignment: Joi.string().valid('unchanged', 'self', 'unassigned').default('unchanged'),
  reason: Joi.string().trim().min(3).max(1000).required(),
}).or('status', 'assignment');
const noteSchema = Joi.object({
  incidentId: incidentIdSchema,
  reason: Joi.string().trim().min(3).max(1000).required(),
});

function target(incidentId) {
  return { type: 'operational_incident', id: incidentId, label: incidentId };
}

function assertIncidentResult(result) {
  if (result.notFound) {
    throw Object.assign(new Error('Operational incident not found.'), {
      code: 'ADMIN_INCIDENT_NOT_FOUND',
      statusCode: 404,
    });
  }
  if (result.invalidTransition) {
    throw Object.assign(
      new Error(`Incident cannot transition from ${result.fromStatus} to ${result.toStatus}.`),
      {
        code: 'ADMIN_INCIDENT_INVALID_TRANSITION',
        statusCode: 409,
      },
    );
  }
  return result;
}

function sendKnownIncidentError(res, error) {
  if (!error?.code?.startsWith('ADMIN_INCIDENT_')) return false;
  res.status(error.statusCode || 409).json({
    status: responseCodes.GENERIC_ERROR,
    errorCode: error.code,
    retryable: false,
    message: error.message,
  });
  return true;
}

exports.listIncidents = async (req, res, next) => {
  try {
    const { error, value } = listSchema.validate(req.query, { stripUnknown: true });
    if (error) throw error;
    const result = await AdminIncidentService.listIncidents(value);
    res.status(200).json({
      status: responseCodes.GENERIC_SUCCESS,
      message: 'Operational incidents retrieved successfully.',
      payload: result.incidents,
      pagination: {
        limit: result.limit,
        offset: result.offset,
        total: result.total,
      },
    });
    res.message = 'Operational incidents retrieved successfully.';
  } catch (error) { next(error); }
};

exports.listIncidentEvents = async (req, res, next) => {
  try {
    const { error, value: incidentId } = incidentIdSchema.validate(req.params.incidentId);
    if (error) throw error;
    const events = await AdminIncidentService.listEvents(incidentId, { limit: 100 });
    res.status(200).json({
      status: responseCodes.GENERIC_SUCCESS,
      message: 'Operational incident history retrieved successfully.',
      payload: events,
    });
    res.message = 'Operational incident history retrieved successfully.';
  } catch (error) { next(error); }
};

exports.updateIncident = async (req, res, next) => {
  try {
    const { error, value } = updateSchema.validate(
      { ...req.params, ...req.body },
      { stripUnknown: true },
    );
    if (error) throw error;
    const result = await AuditLogService.execute(req, {
      eventType: 'incident.lifecycle.update',
      target: target(value.incidentId),
      reason: value.reason,
      metadata: {
        assignment: value.assignment,
        requestedStatus: value.status || null,
      },
    }, async ({ correlationId } = {}) => {
      req.auditCorrelationId = correlationId;
      return assertIncidentResult(
        await AdminIncidentService.updateIncident(value.incidentId, value, req),
      );
    });
    AdminOverviewService.resetOverviewState();
    res.status(200).json({
      status: responseCodes.GENERIC_SUCCESS,
      message: 'Operational incident updated successfully.',
      payload: result.incident,
    });
    res.message = 'Operational incident updated successfully.';
  } catch (error) {
    if (!sendKnownIncidentError(res, error)) next(error);
  }
};

exports.addIncidentNote = async (req, res, next) => {
  try {
    const { error, value } = noteSchema.validate(
      { ...req.params, ...req.body },
      { stripUnknown: true },
    );
    if (error) throw error;
    const result = await AuditLogService.execute(req, {
      eventType: 'incident.note.add',
      target: target(value.incidentId),
      reason: value.reason,
    }, async ({ correlationId } = {}) => {
      req.auditCorrelationId = correlationId;
      return assertIncidentResult(
        await AdminIncidentService.updateIncident(
          value.incidentId,
          { assignment: 'unchanged', reason: value.reason },
          req,
        ),
      );
    });
    AdminOverviewService.resetOverviewState();
    res.status(200).json({
      status: responseCodes.GENERIC_SUCCESS,
      message: 'Operational incident note added successfully.',
      payload: result.incident,
    });
    res.message = 'Operational incident note added successfully.';
  } catch (error) {
    if (!sendKnownIncidentError(res, error)) next(error);
  }
};
