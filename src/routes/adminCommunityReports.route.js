const express = require('express');
const AdminCommunityReportsController = require('../controllers/adminCommunityReports.controller');
const { getTokenFromCookie, verifyTokenWithRole } = require('../middlewares/token.middleware');
const { requireAdminCsrf } = require('../middlewares/adminCsrf.middleware');
const {
  requireAdminCapability,
  requireTypedTargetConfirmation,
} = require('../middlewares/adminActionPolicy.middleware');
const { ACTIONS } = require('../services/adminCapabilities.service');

const router = express.Router();

router.get('/', getTokenFromCookie, verifyTokenWithRole('admin'), AdminCommunityReportsController.listCommunityReports);
router.get(
  '/:commentId/case',
  getTokenFromCookie,
  verifyTokenWithRole('admin'),
  AdminCommunityReportsController.getModerationCase,
);
router.patch(
  '/:commentId/status',
  getTokenFromCookie,
  verifyTokenWithRole('admin'),
  requireAdminCsrf,
  requireAdminCapability(ACTIONS.COMMUNITY_REPORT_MODERATION),
  AdminCommunityReportsController.updateCommunityReportStatus,
);
router.patch(
  '/:commentId/case',
  getTokenFromCookie,
  verifyTokenWithRole('admin'),
  requireAdminCsrf,
  requireAdminCapability(ACTIONS.COMMUNITY_REPORT_MODERATION),
  AdminCommunityReportsController.transitionModerationCase,
);
router.post(
  '/:commentId/case/notes',
  getTokenFromCookie,
  verifyTokenWithRole('admin'),
  requireAdminCsrf,
  requireAdminCapability(ACTIONS.COMMUNITY_REPORT_MODERATION),
  AdminCommunityReportsController.addModerationCaseNote,
);
router.delete(
  '/:commentId',
  getTokenFromCookie,
  verifyTokenWithRole('admin'),
  requireAdminCsrf,
  requireAdminCapability(ACTIONS.COMMUNITY_REPORT_DELETION),
  requireTypedTargetConfirmation({
    actionId: ACTIONS.COMMUNITY_REPORT_DELETION,
    eventType: 'community_report.delete',
    paramName: 'commentId',
    targetType: 'community_report',
  }),
  AdminCommunityReportsController.deleteCommunityReport,
);

module.exports = router;
