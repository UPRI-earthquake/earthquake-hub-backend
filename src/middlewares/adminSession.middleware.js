const AuditLogService = require('../services/auditLog.service');
const { responseCodes } = require('../controllers/responseCodes');

function requireRecentAdminAuthentication({
  maxAgeSeconds = Number.parseInt(process.env.ADMIN_RECENT_AUTH_MAX_AGE_SECONDS, 10) || 900,
} = {}) {
  return async (req, res, next) => {
    const authenticatedAt = Number(req.authTime || 0);
    const ageSeconds = Math.floor(Date.now() / 1000) - authenticatedAt;
    if (authenticatedAt > 0 && ageSeconds >= 0 && ageSeconds <= maxAgeSeconds) {
      next();
      return;
    }
    try {
      await AuditLogService.record(req, {
        eventType: 'admin.reauthentication.required',
        outcome: 'rejected',
        target: {
          type: 'admin_session',
          id: String(req.accountId || req.username || 'unknown'),
          label: req.username,
        },
        reason: req.body?.reason,
        metadata: { maxAgeSeconds, reasonCode: 'recent_authentication_required' },
      });
    } catch (error) {
      console.error('Unable to audit recent-authentication rejection:', error?.message || error);
    }
    res.status(403).json({
      status: responseCodes.GENERIC_ERROR,
      errorCode: 'ADMIN_REAUTHENTICATION_REQUIRED',
      retryable: false,
      message: 'Sign out and sign in again before performing this high-risk action.',
    });
  };
}

module.exports = { requireRecentAdminAuthentication };
