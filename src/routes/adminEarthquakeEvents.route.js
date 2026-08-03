const express = require('express');
const AdminEarthquakeEventsController = require('../controllers/adminEarthquakeEvents.controller');
const { getTokenFromCookie, verifyTokenWithRole } = require('../middlewares/token.middleware');
const { requireAdminCsrf } = require('../middlewares/adminCsrf.middleware');
const { requireAdminCapability } = require('../middlewares/adminActionPolicy.middleware');
const { ACTIONS } = require('../services/adminCapabilities.service');

const router = express.Router();

router.get('/', getTokenFromCookie, verifyTokenWithRole('admin'), AdminEarthquakeEventsController.listEvents);
router.patch(
  '/:publicID/summary',
  getTokenFromCookie,
  verifyTokenWithRole('admin'),
  requireAdminCsrf,
  requireAdminCapability(ACTIONS.EARTHQUAKE_EVENT_SUMMARY),
  AdminEarthquakeEventsController.updateSummary,
);
router.delete(
  '/:publicID/summary',
  getTokenFromCookie,
  verifyTokenWithRole('admin'),
  requireAdminCsrf,
  requireAdminCapability(ACTIONS.EARTHQUAKE_EVENT_SUMMARY),
  AdminEarthquakeEventsController.revertSummary,
);
router.patch(
  '/:publicID/summary/review',
  getTokenFromCookie,
  verifyTokenWithRole('admin'),
  requireAdminCsrf,
  requireAdminCapability(ACTIONS.EARTHQUAKE_EVENT_SUMMARY_REVIEW),
  AdminEarthquakeEventsController.transitionSummaryReview,
);
router.post(
  '/enrichment/run',
  getTokenFromCookie,
  verifyTokenWithRole('admin'),
  requireAdminCsrf,
  requireAdminCapability(ACTIONS.EARTHQUAKE_EVENT_ENRICHMENT),
  AdminEarthquakeEventsController.runEnrichment,
);
router.post(
  '/recording-availability/run',
  getTokenFromCookie,
  verifyTokenWithRole('admin'),
  requireAdminCsrf,
  requireAdminCapability(ACTIONS.EARTHQUAKE_EVENT_RECORDING_REFRESH),
  AdminEarthquakeEventsController.refreshRecordingAvailability,
);

module.exports = router;
