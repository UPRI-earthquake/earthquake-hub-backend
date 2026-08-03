const crypto = require('crypto');
const AdminCapabilitiesService = require('../services/adminCapabilities.service');
const AuditLogService = require('../services/auditLog.service');
const { responseCodes } = require('../controllers/responseCodes');

function exactMatch(actual, expected) {
  const left = Buffer.from(String(actual || ''), 'utf8');
  const right = Buffer.from(String(expected || ''), 'utf8');
  return left.length === right.length
    && left.length > 0
    && crypto.timingSafeEqual(left, right);
}

function rejectionResponse(res, {
  errorCode,
  message,
  statusCode,
}) {
  return res.status(statusCode).json({
    status: responseCodes.GENERIC_ERROR,
    errorCode,
    retryable: false,
    message,
  });
}

function requireAdminCapability(actionId) {
  return async (req, res, next) => {
    const capability = AdminCapabilitiesService.getCapability(
      actionId,
      req.adminRole || 'super_admin',
    );
    if (capability?.enabled) {
      next();
      return;
    }

    try {
      await AuditLogService.record(req, {
        eventType: 'admin.capability.rejected',
        outcome: 'rejected',
        target: { type: 'admin_capability', id: actionId, label: actionId },
        reason: req.body?.reason,
        metadata: { actionId, reasonCode: 'capability_disabled' },
      });
    } catch (error) {
      console.error('Unable to record disabled admin capability request:', error?.message || error);
    }

    rejectionResponse(res, {
      statusCode: 403,
      errorCode: 'ADMIN_CAPABILITY_DISABLED',
      message: capability?.unavailableReason || 'This administrative action is currently disabled.',
    });
  };
}

function requireAdminCapabilityWhenAdmin(actionId) {
  const requireCapability = requireAdminCapability(actionId);
  return (req, res, next) => {
    if (req.role !== 'admin') {
      next();
      return;
    }
    return requireCapability(req, res, next);
  };
}

function requireTypedTargetConfirmation({
  actionId,
  bodyName,
  eventType,
  paramName,
  targetType,
}) {
  return async (req, res, next) => {
    const targetId = String(
      (paramName ? req.params?.[paramName] : '')
      || (bodyName ? req.body?.[bodyName] : '')
      || '',
    );
    if (exactMatch(req.body?.confirmation, targetId)) {
      next();
      return;
    }

    try {
      await AuditLogService.record(req, {
        eventType,
        outcome: 'rejected',
        target: { type: targetType, id: targetId, label: targetId },
        reason: req.body?.reason,
        metadata: { actionId, reasonCode: 'typed_confirmation_mismatch' },
      });
    } catch (error) {
      console.error('Unable to record rejected admin confirmation:', error?.message || error);
    }

    rejectionResponse(res, {
      statusCode: 400,
      errorCode: 'ADMIN_CONFIRMATION_MISMATCH',
      message: `Type ${targetId} exactly to confirm this destructive action.`,
    });
  };
}

module.exports = {
  exactMatch,
  requireAdminCapability,
  requireAdminCapabilityWhenAdmin,
  requireTypedTargetConfirmation,
};
