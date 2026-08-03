const express = require('express');
const AdminDevicesStationsController = require('../controllers/adminDevicesStations.controller');
const { getTokenFromCookie, verifyTokenWithRole } = require('../middlewares/token.middleware');
const { requireAdminCsrf } = require('../middlewares/adminCsrf.middleware');
const {
  requireAdminCapability,
  requireTypedTargetConfirmation,
} = require('../middlewares/adminActionPolicy.middleware');
const { ACTIONS } = require('../services/adminCapabilities.service');

const router = express.Router();
router.get('/', getTokenFromCookie, verifyTokenWithRole('admin'), AdminDevicesStationsController.listDevices);
router.get('/ringserver-targets', getTokenFromCookie, verifyTokenWithRole('admin'), AdminDevicesStationsController.listAllowedTargets);
router.get('/:deviceId/history', getTokenFromCookie, verifyTokenWithRole('admin'), AdminDevicesStationsController.listHistory);
router.get('/:deviceId/freshness', getTokenFromCookie, verifyTokenWithRole('admin'), AdminDevicesStationsController.listFreshness);
router.get('/:deviceId/tunnel-observation', getTokenFromCookie, verifyTokenWithRole('admin'), AdminDevicesStationsController.getTunnelObservation);
router.get('/:deviceId/remote-servers', getTokenFromCookie, verifyTokenWithRole('admin'), AdminDevicesStationsController.listRemoteServers);
router.post(
  '/:deviceId/remote-actions',
  getTokenFromCookie,
  verifyTokenWithRole('admin'),
  requireAdminCsrf,
  requireAdminCapability(ACTIONS.DEVICE_REMOTE_CONFIGURATION),
  AdminDevicesStationsController.executeRemoteAction,
);
router.post(
  '/:deviceId/tunnel/revoke',
  getTokenFromCookie,
  verifyTokenWithRole('admin'),
  requireAdminCsrf,
  requireAdminCapability(ACTIONS.DEVICE_TUNNEL_REVOCATION),
  requireTypedTargetConfirmation({
    actionId: ACTIONS.DEVICE_TUNNEL_REVOCATION,
    eventType: 'device.tunnel.revoke',
    paramName: 'deviceId',
    targetType: 'device_station',
  }),
  AdminDevicesStationsController.revokeTunnel,
);
module.exports = router;
