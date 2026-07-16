const express = require('express');
const AdminConfigurationDiagnosticsController = require('../controllers/adminConfigurationDiagnostics.controller');
const { getTokenFromCookie, verifyTokenWithRole } = require('../middlewares/token.middleware');

const router = express.Router();

router.get('/snapshot', getTokenFromCookie, verifyTokenWithRole('admin'), AdminConfigurationDiagnosticsController.getSnapshot);

module.exports = router;
