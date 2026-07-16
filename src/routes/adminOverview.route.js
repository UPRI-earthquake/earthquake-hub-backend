const express = require('express');
const AdminOverviewController = require('../controllers/adminOverview.controller');
const { getTokenFromCookie, verifyTokenWithRole } = require('../middlewares/token.middleware');

const router = express.Router();

router.get('/snapshot', getTokenFromCookie, verifyTokenWithRole('admin'), AdminOverviewController.getSnapshot);

module.exports = router;
