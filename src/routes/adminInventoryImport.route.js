const express = require('express');
const AdminInventoryImportController = require('../controllers/adminInventoryImport.controller');
const { getTokenFromCookie, verifyTokenWithRole } = require('../middlewares/token.middleware');

const router = express.Router();
router.get('/workflow', getTokenFromCookie, verifyTokenWithRole('admin'), AdminInventoryImportController.getWorkflow);
module.exports = router;
