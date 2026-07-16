const express = require('express');
const AdminDeploymentHealthController = require('../controllers/adminDeploymentHealth.controller');
const { getTokenFromCookie, verifyTokenWithRole } = require('../middlewares/token.middleware');

const router = express.Router();

router.get('/snapshot', getTokenFromCookie, verifyTokenWithRole('admin'), AdminDeploymentHealthController.getSnapshot);

module.exports = router;
