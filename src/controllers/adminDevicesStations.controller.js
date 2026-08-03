const Joi = require('joi');
const AdminDevicesStationsService = require('../services/adminDevicesStations.service');
const TunnelEnrollmentService = require('../services/tunnelEnrollment.service');
const RemoteDeviceActionsService = require('../services/remoteDeviceActions.service');
const StationOperationalHistoryService = require('../services/stationOperationalHistory.service');
const StationTelemetryService = require('../services/stationTelemetry.service');
const AuditLogService = require('../services/auditLog.service');
const { responseCodes } = require('./responseCodes');

const deviceIdSchema = Joi.string().trim().uppercase().pattern(/^[A-Z0-9]{2,10}_[A-Z0-9]{1,10}$/).required();
const reasonSchema = Joi.string().trim().min(3).max(1000).required();
const listSchema = Joi.object({
  network: Joi.string().trim().uppercase().max(10).optional(),
  activity: Joi.string().trim().max(32).optional(),
  attention: Joi.boolean().truthy('true').falsy('false').optional(),
  isActive: Joi.boolean().truthy('true').falsy('false').optional(),
  hasTunnel: Joi.boolean().truthy('true').falsy('false').optional(),
  search: Joi.string().trim().max(100).allow('').optional(),
  limit: Joi.number().integer().min(1).max(100).default(25),
  offset: Joi.number().integer().min(0).default(0),
});

function sendRemoteError(res, error) {
  const statusCode = error?.httpStatus || (error?.code === 'offline' || error?.code === 'not_mapped' ? 409 : 500);
  return res.status(statusCode).json({ status: responseCodes.GENERIC_ERROR, message: error?.message || 'Remote station action failed.', errorCode: error?.code || 'remote_action_error' });
}

exports.listDevices = async (req, res, next) => {
  try {
    const { error, value } = listSchema.validate(req.query, { stripUnknown: true });
    if (error) throw error;
    const result = await AdminDevicesStationsService.listDevices({ ...value, includeSummary: true });
    res.status(200).json({ status: responseCodes.GENERIC_SUCCESS, message: 'Devices and stations retrieved successfully.', payload: result.devices, pagination: { total: result.total, limit: result.limit, offset: result.offset }, summary: result.summary });
    res.message = 'Devices and stations retrieved successfully.';
  } catch (error) { next(error); }
};

exports.listHistory = async (req, res, next) => {
  try {
    const { error, value } = Joi.object({
      deviceId: deviceIdSchema,
      cursor: Joi.string().trim().max(1024).optional(),
      eventType: Joi.string().valid('activity_changed', 'tunnel_enrolled', 'tunnel_revoked').optional(),
      limit: Joi.number().integer().min(1).max(100).default(25),
    }).validate({ ...req.params, ...req.query }, { stripUnknown: true });
    if (error) throw error;
    const result = await StationOperationalHistoryService.listHistory(value);
    res.status(200).json({
      status: responseCodes.GENERIC_SUCCESS,
      message: 'Station operational history retrieved successfully.',
      payload: result.events,
      pagination: { limit: result.limit, nextCursor: result.nextCursor },
    });
    res.message = 'Station operational history retrieved successfully.';
  } catch (error) { next(error); }
};

exports.listFreshness = async (req, res, next) => {
  try {
    const { error, value } = Joi.object({
      deviceId: deviceIdSchema,
      hours: Joi.number().integer().valid(...StationTelemetryService.ALLOWED_WINDOWS_HOURS).default(24),
    }).validate({ ...req.params, ...req.query }, { stripUnknown: true });
    if (error) throw error;
    const result = await StationTelemetryService.listFreshness(value);
    res.status(200).json({
      status: responseCodes.GENERIC_SUCCESS,
      message: 'Station packet freshness retrieved successfully.',
      payload: result.samples,
      summary: result.summary,
    });
    res.message = 'Station packet freshness retrieved successfully.';
  } catch (error) { next(error); }
};

exports.getTunnelObservation = async (req, res, next) => {
  try {
    const { error, value } = Joi.object({ deviceId: deviceIdSchema }).validate(req.params);
    if (error) throw error;
    const result = await AdminDevicesStationsService.getTunnelObservation({ deviceId: value.deviceId, req });
    res.status(200).json({
      status: responseCodes.GENERIC_SUCCESS,
      message: 'Station WSTunnel listener evidence retrieved successfully.',
      payload: result,
    });
    res.message = 'Station WSTunnel listener evidence retrieved successfully.';
  } catch (error) { next(error); }
};

exports.listRemoteServers = async (req, res, next) => {
  try {
    const { error, value } = Joi.object({ deviceId: deviceIdSchema }).validate(req.params);
    if (error) throw error;
    const result = await RemoteDeviceActionsService.listAdminRemoteDeviceServers(value);
    res.status(200).json({ status: responseCodes.GENERIC_SUCCESS, message: 'Remote station servers retrieved successfully.', payload: result });
    res.message = 'Remote station servers retrieved successfully.';
  } catch (error) {
    if (error?.name === 'RemoteDeviceActionError') return sendRemoteError(res, error);
    next(error);
  }
};

exports.listAllowedTargets = async (_req, res, next) => {
  try {
    const targets = await RemoteDeviceActionsService.listAllowedRingserverTargets();
    res.status(200).json({ status: responseCodes.GENERIC_SUCCESS, message: 'Allowed ringserver targets retrieved successfully.', payload: targets });
    res.message = 'Allowed ringserver targets retrieved successfully.';
  } catch (error) { next(error); }
};

exports.executeRemoteAction = async (req, res, next) => {
  const schema = Joi.object({
    deviceId: deviceIdSchema,
    action: Joi.string().trim().uppercase().valid('ADD_SERVER', 'REMOVE_SERVER').required(),
    payload: Joi.object({ institutionName: Joi.string().trim().max(256), url: Joi.string().trim().max(1024) }).unknown(false).default({}),
    reason: reasonSchema,
  });
  try {
    const { error, value } = schema.validate({ ...req.params, ...req.body }, { stripUnknown: true });
    if (error) throw error;
    const result = await AuditLogService.execute(req, {
      eventType: `device.remote_action.${value.action.toLowerCase()}`,
      target: { type: 'device_station', id: value.deviceId, label: value.deviceId },
      reason: value.reason,
      metadata: { action: value.action, targetUrl: value.payload.url },
    }, () => RemoteDeviceActionsService.executeAdminRemoteDeviceAction(value));
    res.status(200).json({ status: responseCodes.GENERIC_SUCCESS, message: 'Remote station action completed successfully.', payload: result });
    res.message = 'Remote station action completed successfully.';
  } catch (error) {
    if (error?.name === 'RemoteDeviceActionError') return sendRemoteError(res, error);
    next(error);
  }
};

exports.revokeTunnel = async (req, res, next) => {
  try {
    const { error, value } = Joi.object({ deviceId: deviceIdSchema, reason: reasonSchema }).validate({ ...req.params, ...req.body }, { stripUnknown: true });
    if (error) throw error;
    const result = await AuditLogService.execute(req, {
      eventType: 'device.tunnel.revoke',
      target: { type: 'device_station', id: value.deviceId, label: value.deviceId },
      reason: value.reason,
    }, async ({ correlationId } = {}) => {
      const revoked = await TunnelEnrollmentService.revokeDeviceTunnel(value.deviceId);
      await StationOperationalHistoryService.appendTunnelTransition({
        actor: {
          accountId: req.accountId,
          username: req.username,
          role: req.adminRole || req.role,
        },
        correlationId,
        deviceId: value.deviceId,
        eventType: 'tunnel_revoked',
      }).catch((historyError) => {
        console.error(`Failed to retain WSTunnel revocation for ${value.deviceId}:`, historyError);
      });
      return revoked;
    });
    res.status(200).json({ status: responseCodes.GENERIC_SUCCESS, message: 'Device tunnel revoked successfully.', payload: result });
    res.message = 'Device tunnel revoked successfully.';
  } catch (error) {
    if (error?.name === 'TunnelEnrollmentError') return res.status(error.code === 'NOT_FOUND' ? 404 : 502).json({ status: responseCodes.GENERIC_ERROR, message: error.message || 'Failed to revoke device tunnel.' });
    next(error);
  }
};
