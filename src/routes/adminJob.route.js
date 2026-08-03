const express = require('express');
const AdminJobController = require('../controllers/adminJob.controller');
const { requireAdminCsrf } = require('../middlewares/adminCsrf.middleware');
const { getTokenFromCookie, verifyTokenWithRole } = require('../middlewares/token.middleware');

const router = express.Router();

router.get(
  '/',
  getTokenFromCookie,
  verifyTokenWithRole('admin'),
  AdminJobController.listJobs,
);
router.get(
  '/:jobId',
  getTokenFromCookie,
  verifyTokenWithRole('admin'),
  AdminJobController.getJob,
);
router.post(
  '/:jobId/retry',
  getTokenFromCookie,
  verifyTokenWithRole('admin'),
  requireAdminCsrf,
  AdminJobController.retryJob,
);

module.exports = router;
