const express = require('express');
const AdminSeiscompController = require('../controllers/adminSeiscomp.controller');
const { getTokenFromCookie, verifyTokenWithRole } = require('../middlewares/token.middleware');

const router = express.Router();
router.get('/snapshot', getTokenFromCookie, verifyTokenWithRole('admin'), AdminSeiscompController.getSnapshot);
module.exports = router;
