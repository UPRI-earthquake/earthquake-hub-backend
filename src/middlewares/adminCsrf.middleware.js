const crypto = require('crypto');

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
function requireAdminCsrf(req, res, next) {
  const headerToken = req.get('X-CSRF-Token');
  const cookieToken = req.cookies?.csrfToken;
  if (!tokensMatch(headerToken, cookieToken) || !tokensMatch(headerToken, req.csrfToken)) {
    return res.status(403).json({
      status: 403,
      message: 'Valid CSRF token required for this admin action.',
    });
  }
  return next();
}

function requireAdminCsrfWhenAdmin(req, res, next) {
  if (req.role !== 'admin') return next();
  return requireAdminCsrf(req, res, next);
}

module.exports = { requireAdminCsrf, requireAdminCsrfWhenAdmin, tokensMatch };
