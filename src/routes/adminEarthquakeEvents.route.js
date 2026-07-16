const express = require('express');
const AdminEarthquakeEventsController = require('../controllers/adminEarthquakeEvents.controller');
const { getTokenFromCookie, verifyTokenWithRole } = require('../middlewares/token.middleware');
const { requireAdminCsrf } = require('../middlewares/adminCsrf.middleware');

const router = express.Router();

router.get('/', getTokenFromCookie, verifyTokenWithRole('admin'), AdminEarthquakeEventsController.listEvents);
router.patch('/:publicID/summary', getTokenFromCookie, verifyTokenWithRole('admin'), requireAdminCsrf, AdminEarthquakeEventsController.updateSummary);
router.delete('/:publicID/summary', getTokenFromCookie, verifyTokenWithRole('admin'), requireAdminCsrf, AdminEarthquakeEventsController.revertSummary);
router.post('/enrichment/run', getTokenFromCookie, verifyTokenWithRole('admin'), requireAdminCsrf, AdminEarthquakeEventsController.runEnrichment);

module.exports = router;
