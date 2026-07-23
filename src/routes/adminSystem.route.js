const express = require('express');
const AdminSystemController = require('../controllers/adminSystem.controller');
const { getTokenFromCookie, verifyTokenWithRole } = require('../middlewares/token.middleware');

const router = express.Router();

router.get('/snapshot', getTokenFromCookie, verifyTokenWithRole('admin'), AdminSystemController.getSnapshot);

module.exports = router;
