const express = require('express');
const AdminAccountsController = require('../controllers/adminAccounts.controller');
const { getTokenFromCookie, verifyTokenWithRole } = require('../middlewares/token.middleware');
const { requireAdminCsrf } = require('../middlewares/adminCsrf.middleware');

const router = express.Router();
router.get('/', getTokenFromCookie, verifyTokenWithRole('admin'), AdminAccountsController.listAccounts);
router.patch('/:accountId/approval', getTokenFromCookie, verifyTokenWithRole('admin'), requireAdminCsrf, AdminAccountsController.setBrgyApproval);
module.exports = router;
