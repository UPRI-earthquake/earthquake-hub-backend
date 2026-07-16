const express = require('express');
const AdminCommunityReportsController = require('../controllers/adminCommunityReports.controller');
const { getTokenFromCookie, verifyTokenWithRole } = require('../middlewares/token.middleware');
const { requireAdminCsrf } = require('../middlewares/adminCsrf.middleware');

const router = express.Router();

router.get('/', getTokenFromCookie, verifyTokenWithRole('admin'), AdminCommunityReportsController.listCommunityReports);
router.patch('/:commentId/status', getTokenFromCookie, verifyTokenWithRole('admin'), requireAdminCsrf, AdminCommunityReportsController.updateCommunityReportStatus);
router.delete('/:commentId', getTokenFromCookie, verifyTokenWithRole('admin'), requireAdminCsrf, AdminCommunityReportsController.deleteCommunityReport);

module.exports = router;
