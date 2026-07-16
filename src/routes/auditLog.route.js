const express = require('express');
const AuditLogController = require('../controllers/auditLog.controller');
const { getTokenFromCookie, verifyTokenWithRole } = require('../middlewares/token.middleware');

const router = express.Router();

// Audit records are server-written. This endpoint is intentionally read-only.
router.get('/', getTokenFromCookie, verifyTokenWithRole('admin'), AuditLogController.listAuditLogs);

module.exports = router;
