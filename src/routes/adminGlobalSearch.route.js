const express = require('express');
const AdminGlobalSearchController = require('../controllers/adminGlobalSearch.controller');
const { createInMemoryRateLimiter } = require('../middlewares/rateLimit.middleware');
const { getTokenFromCookie, verifyTokenWithRole } = require('../middlewares/token.middleware');

const router = express.Router();
const searchRateLimiter = createInMemoryRateLimiter({
  windowMs: 60 * 1000,
  max: 60,
  message: 'Too many global search requests. Please wait before searching again.',
});

router.get(
  '/',
  getTokenFromCookie,
  verifyTokenWithRole('admin'),
  searchRateLimiter,
  AdminGlobalSearchController.search,
);

module.exports = router;
