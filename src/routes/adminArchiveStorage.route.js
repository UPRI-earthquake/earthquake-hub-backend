const express = require('express');
const AdminArchiveStorageController = require('../controllers/adminArchiveStorage.controller');
const { getTokenFromCookie, verifyTokenWithRole } = require('../middlewares/token.middleware');

const router = express.Router();
router.get('/snapshot', getTokenFromCookie, verifyTokenWithRole('admin'), AdminArchiveStorageController.getSnapshot);
module.exports = router;
