const crypto = require('crypto');
const AuditLogService = require('../services/auditLog.service');

function tokensMatch(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

/**
 * Protects cookie-authenticated, privileged admin mutations. The request must
 * present the same token in its readable same-site cookie, custom header, and
 * signed access-token claim.
 */
async function requireAdminCsrf(req, res, next) {
  const headerToken = req.get('X-CSRF-Token');
  const cookieToken = req.cookies?.csrfToken;
  if (!tokensMatch(headerToken, cookieToken) || !tokensMatch(headerToken, req.csrfToken)) {
    try {
      if (typeof AuditLogService.record === 'function') {
        await AuditLogService.record(req, {
          eventType: 'admin.csrf.rejected',
          outcome: 'rejected',
          target: {
            type: 'admin_request',
            id: String(req.path || req.originalUrl || 'unknown').slice(0, 512),
            label: 'Rejected administrative mutation',
          },
          metadata: { method: req.method },
        });
      }
    } catch (error) {
      console.error('Unable to record rejected admin CSRF request:', error?.message || error);
    }
    return res.status(403).json({
      status: 403,
      message: 'Valid CSRF token required for this admin action.',
    });
  }
  return next();
}

async function requireAdminCsrfWhenAdmin(req, res, next) {
  if (req.role !== 'admin') return next();
  return requireAdminCsrf(req, res, next);
}

module.exports = { requireAdminCsrf, requireAdminCsrfWhenAdmin, tokensMatch };
