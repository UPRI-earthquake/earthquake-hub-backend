const express = require('express');
const AdminController = require('../controllers/admin.controller');
const {
  getTokenFromCookieIfPresent,
  verifyTokenWithRoleOptional,
} = require('../middlewares/token.middleware');
const {
  createInMemoryRateLimiter,
  positiveIntegerEnv,
} = require('../middlewares/rateLimit.middleware');

const router = express.Router();

const adminAuthRateLimitWindowMs = positiveIntegerEnv(
  'ADMIN_AUTH_RATE_LIMIT_WINDOW_MS',
  15 * 60 * 1000,
);
const limitAdminAuthByIp = createInMemoryRateLimiter({
  windowMs: adminAuthRateLimitWindowMs,
  max: positiveIntegerEnv('ADMIN_AUTH_RATE_LIMIT_IP_MAX', 30),
  keyGenerator: (req) => req.ip || 'unknown',
  message: 'Too many admin login attempts. Please try again later.',
});
const limitAdminAuthByIdentifier = createInMemoryRateLimiter({
  windowMs: adminAuthRateLimitWindowMs,
  max: positiveIntegerEnv('ADMIN_AUTH_RATE_LIMIT_IDENTIFIER_MAX', 5),
  keyGenerator: (req) => {
    const identifier = req.body?.identifier || req.body?.username || 'unknown';
    return String(identifier).trim().toLowerCase();
  },
  message: 'Too many login attempts for this account. Please try again later.',
});

router.post(
  '/authenticate',
  limitAdminAuthByIp,
  limitAdminAuthByIdentifier,
  AdminController.authenticateAdmin,
);
router.get(
  '/profile',
  getTokenFromCookieIfPresent,
  verifyTokenWithRoleOptional('admin'),
  AdminController.getAdminProfile,
);
router.post('/signout', AdminController.signOutAdmin);

module.exports = router;
