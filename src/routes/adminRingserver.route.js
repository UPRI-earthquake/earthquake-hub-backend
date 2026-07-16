const express = require('express');
const AdminRingserverController = require('../controllers/adminRingserver.controller');
const { getTokenFromCookie, verifyTokenWithRole } = require('../middlewares/token.middleware');

const router = express.Router();

router.get('/snapshot', getTokenFromCookie, verifyTokenWithRole('admin'), AdminRingserverController.getSnapshot);

module.exports = router;
