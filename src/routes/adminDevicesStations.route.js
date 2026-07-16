const express = require('express');
const AdminDevicesStationsController = require('../controllers/adminDevicesStations.controller');
const { getTokenFromCookie, verifyTokenWithRole } = require('../middlewares/token.middleware');
const { requireAdminCsrf } = require('../middlewares/adminCsrf.middleware');

const router = express.Router();
router.get('/', getTokenFromCookie, verifyTokenWithRole('admin'), AdminDevicesStationsController.listDevices);
router.get('/ringserver-targets', getTokenFromCookie, verifyTokenWithRole('admin'), AdminDevicesStationsController.listAllowedTargets);
router.get('/:deviceId/remote-servers', getTokenFromCookie, verifyTokenWithRole('admin'), AdminDevicesStationsController.listRemoteServers);
router.post('/:deviceId/remote-actions', getTokenFromCookie, verifyTokenWithRole('admin'), requireAdminCsrf, AdminDevicesStationsController.executeRemoteAction);
router.post('/:deviceId/tunnel/revoke', getTokenFromCookie, verifyTokenWithRole('admin'), requireAdminCsrf, AdminDevicesStationsController.revokeTunnel);
module.exports = router;
