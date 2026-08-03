const express = require('express');
const AdminIncidentController = require('../controllers/adminIncident.controller');
const { requireAdminCapability } = require('../middlewares/adminActionPolicy.middleware');
const { requireAdminCsrf } = require('../middlewares/adminCsrf.middleware');
const { getTokenFromCookie, verifyTokenWithRole } = require('../middlewares/token.middleware');
const { ACTIONS } = require('../services/adminCapabilities.service');

const router = express.Router();

router.get(
  '/',
  getTokenFromCookie,
  verifyTokenWithRole('admin'),
  AdminIncidentController.listIncidents,
);
router.get(
  '/:incidentId/events',
  getTokenFromCookie,
  verifyTokenWithRole('admin'),
  AdminIncidentController.listIncidentEvents,
);
router.patch(
  '/:incidentId',
  getTokenFromCookie,
  verifyTokenWithRole('admin'),
  requireAdminCsrf,
  requireAdminCapability(ACTIONS.INCIDENT_MANAGEMENT),
  AdminIncidentController.updateIncident,
);
router.post(
  '/:incidentId/notes',
  getTokenFromCookie,
  verifyTokenWithRole('admin'),
  requireAdminCsrf,
  requireAdminCapability(ACTIONS.INCIDENT_MANAGEMENT),
  AdminIncidentController.addIncidentNote,
);

module.exports = router;
