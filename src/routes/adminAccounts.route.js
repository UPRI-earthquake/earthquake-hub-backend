const express = require('express');
const AdminAccountsController = require('../controllers/adminAccounts.controller');
const { getTokenFromCookie, verifyTokenWithRole } = require('../middlewares/token.middleware');
const { requireAdminCsrf } = require('../middlewares/adminCsrf.middleware');
const {
  requireAdminCapability,
  requireTypedTargetConfirmation,
} = require('../middlewares/adminActionPolicy.middleware');
const { requireRecentAdminAuthentication } = require('../middlewares/adminSession.middleware');
const { ACTIONS } = require('../services/adminCapabilities.service');

const router = express.Router();
router.get('/', getTokenFromCookie, verifyTokenWithRole('admin'), AdminAccountsController.listAccounts);
router.patch(
  '/:accountId/approval',
  getTokenFromCookie,
  verifyTokenWithRole('admin'),
  requireAdminCsrf,
  requireAdminCapability(ACTIONS.ACCOUNT_BRGY_APPROVAL),
  AdminAccountsController.setBrgyApproval,
);
router.patch(
  '/:accountId/lifecycle',
  getTokenFromCookie,
  verifyTokenWithRole('admin'),
  requireAdminCsrf,
  requireAdminCapability(ACTIONS.ACCOUNT_LIFECYCLE),
  requireRecentAdminAuthentication(),
  requireTypedTargetConfirmation({
    actionId: ACTIONS.ACCOUNT_LIFECYCLE,
    eventType: 'account.lifecycle.rejected',
    paramName: 'accountId',
    targetType: 'account',
  }),
  AdminAccountsController.setAccountLifecycle,
);
router.post(
  '/:accountId/sessions/revoke',
  getTokenFromCookie,
  verifyTokenWithRole('admin'),
  requireAdminCsrf,
  requireAdminCapability(ACTIONS.ACCOUNT_SESSION_REVOCATION),
  requireRecentAdminAuthentication(),
  AdminAccountsController.revokeAccountSessions,
);
router.patch(
  '/:accountId/admin-role',
  getTokenFromCookie,
  verifyTokenWithRole('admin'),
  requireAdminCsrf,
  requireAdminCapability(ACTIONS.ACCOUNT_ADMIN_ROLE),
  requireRecentAdminAuthentication(),
  requireTypedTargetConfirmation({
    actionId: ACTIONS.ACCOUNT_ADMIN_ROLE,
    eventType: 'account.admin_role.rejected',
    paramName: 'accountId',
    targetType: 'account',
  }),
  AdminAccountsController.setAdminRole,
);
module.exports = router;
