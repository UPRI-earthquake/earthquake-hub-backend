const express = require('express');
const router = express.Router();
const EQEventsController = require('../controllers/EQevents.controller');
const { cacheSeconds } = require('../middlewares/cache.middleware');
const {
  getTokenFromCookie,
  verifyTokenWithRole,
} = require('../middlewares/token.middleware');
const { requireAdminCsrf, requireAdminCsrfWhenAdmin } = require('../middlewares/adminCsrf.middleware');
const AdminEarthquakeEventsController = require('../controllers/adminEarthquakeEvents.controller');
const { requireAdminCapabilityWhenAdmin } = require('../middlewares/adminActionPolicy.middleware');
const { ACTIONS } = require('../services/adminCapabilities.service');

/**
  * @swagger
  * /eq-events:
  *   get:
  *     summary: Get recorded seismic events in the network within a specific time range
  *     tags: [EQ Events]
  *     parameters:
  *       - in: query
  *         name: startTime
  *         schema:
  *           type: string
  *           format: date-time
  *         description: The start time of the events (yyyy-MM-dd HH:mm:ss.S)
  *         required: true
  *         example: "2022-09-09 14:30:00.0"
  *       - in: query
  *         name: endTime
  *         schema:
  *           type: string
  *           format: date-time
  *         description: The start time of the events (yyyy-MM-dd HH:mm:ss.S)
  *         required: true
  *         example: "2023-09-09 14:30:00.0"
  *     responses:
  *       200:
  *         description: EQ events acquired successfully.
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               properties:
  *                 status:
  *                   type: number
  *                   description: The status code for the response.
  *                   example: 0
  *                 message:
  *                   type: string
  *                   description: The message associated with the response.
  *                   example: "EQ events acquired successfully"
  *                 payload:
  *                   type: array
  *                   description: The array containing earthquake event data as detected by SeisComP.
  *                   items:
  *                     type: object
  *                     properties:
  *                       _id:
  *                         type: string
  *                         description: The unique identifier of the earthquake event.
  *                       publicID:
  *                         type: string
  *                         description: The public ID of the earthquake event.
  *                       OT:
  *                         type: string
  *                         format: date-time
  *                         description: The occurrence time of the earthquake event.
  *                       latitude_value:
  *                         type: number
  *                         format: float
  *                         description: The latitude value of the earthquake event.
  *                       longitude_value:
  *                         type: number
  *                         format: float
  *                         description: The longitude value of the earthquake event.
  *                       depth_value:
  *                         type: number
  *                         format: float
  *                         description: The depth value of the earthquake event.
  *                       magnitude_value:
  *                         type: number
  *                         format: float
  *                         description: The magnitude value of the earthquake event.
  *                       type:
  *                         type: string
  *                         description: The type of the earthquake event.
  *                       text:
  *                         type: string
  *                         description: Default location text as generated from SeisComP
  *                       place:
  *                         type: string
  *                         description: More specific location acquired via Geoserve API
  *             examples:
  *               example1:
  *                 value:
  *                   status: responseCodes.GENERIC_SUCCESS
  *                   message: "EQ events acquired successfully"
  *                   payload:
  *                     - _id: "649ad196820cffdfa3fa48cb"
  *                       publicID: "result.value.publicID"
  *                       OT: "2022-09-09T14:39:21.000Z"
  *                       latitude_value: 14.123
  *                       longitude_value: 123.123
  *                       depth_value: 1.1
  *                       magnitude_value: 2.1
  *                       type: "M"
  *                       text: "Quezon City, Philippines"
  *                       place: "40km North of Manila"
  *                     - _id: "649ad1b2820cffdfa3fa48d0"
  *                       publicID: "result.value.publicID"
  *                       OT: "2023-06-09T14:39:21.000Z"
  *                       latitude_value: 14.123
  *                       longitude_value: 123.123
  *                       depth_value: 1.1
  *                       magnitude_value: 2.1
  *                       type: "M"
  *                       text: "Quezon City, Philippines"
  *                       place: "Unavailable"
  *       '500':
  *         description: Internal server error
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               properties:
  *                 status:
  *                   type: number
  *                   example: responseCodes.GENERIC_ERROR
  *                 message:
  *                   type: string
  *                   example: "Server error occured"
  */
// Cache recent EQ events briefly to reduce load on repeat queries
router.get('/', cacheSeconds(60), EQEventsController.getEQEvents);

/**
  * @swagger
  * /eq-events/{publicID}:
  *   get:
  *     summary: Get one recorded seismic event by public ID
  *     tags: [EQ Events]
  *     parameters:
  *       - in: path
  *         name: publicID
  *         schema:
  *           type: string
  *         description: The SeisComP public ID of the earthquake event
  *         required: true
  *         example: "upri-event-001"
  *     responses:
  *       200:
  *         description: EQ event acquired successfully.
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               properties:
  *                 status:
  *                   type: number
  *                   example: 0
  *                 message:
  *                   type: string
  *                   example: "EQ event acquired successfully"
  *                 payload:
  *                   $ref: '#/components/schemas/Event'
  *       400:
  *         description: Invalid public ID
  *       404:
  *         description: Earthquake event was not found
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               properties:
  *                 status:
  *                   type: number
  *                   example: 1
  *                 message:
  *                   type: string
  *                   example: "Earthquake with publicID \"upri-event-001\" was not found."
  *                 payload:
  *                   nullable: true
  *                   example: null
  *       500:
  *         description: Internal server error
  */
router.get('/:publicID', cacheSeconds(60), EQEventsController.getEQEventByPublicID);

/**
  * @swagger
  * /eq-events/restricted/update-online-stations:
  *   post:
  *     summary: Admin maintenance endpoint to update onlineStations for all events
  *     tags: [EQ Events]
  *     security:
  *       - cookieAuth: []
  *     responses:
  *       200:
  *         description: Online stations updated successfully.
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               properties:
  *                 status:
  *                   type: number
  *                   description: The status code for the response.
  *                   example: 0
  *                 message:
  *                   type: string
  *                   description: The message associated with the response.
  *                   example: "Updated onlineStations: 10 events modified, 10 events matched, 0 events skipped, using 5 devices."
  *                 payload:
  *                   type: object
  *                   properties:
  *                     matchedCount:
  *                       type: number
  *                       example: 10
  *                     modifiedCount:
  *                       type: number
  *                       example: 10
  *                     usableDevicesCount:
  *                       type: number
  *                       example: 5
  *       '500':
  *         description: Internal server error
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               properties:
  *                 status:
  *                   type: number
  *                   example: responseCodes.GENERIC_ERROR
  *                 message:
  *                   type: string
  *                   example: "Server error occurred"
  */
router.post(
  '/restricted/update-online-stations',
  getTokenFromCookie,
  verifyTokenWithRole('admin'),
  requireAdminCsrf,
  requireAdminCapabilityWhenAdmin(ACTIONS.EARTHQUAKE_EVENT_RECORDING_REFRESH),
  AdminEarthquakeEventsController.refreshRecordingAvailability,
);

/**
  * @swagger
  * /eq-events/restricted/scrape-additional-information:
  *   post:
  *     summary: Admin maintenance endpoint to run additional catalog enrichment
  *     tags: [EQ Events]
  *     security:
  *       - cookieAuth: []
  *     responses:
  *       200:
  *         description: Additional catalog information enrichment completed.
  *       403:
  *         description: Admin session cookie is required.
  *       409:
  *         description: Enrichment is already running.
  *       '500':
  *         description: Internal server error
  */
router.post(
  '/restricted/scrape-additional-information',
  getTokenFromCookie,
  verifyTokenWithRole('admin'),
  requireAdminCsrf,
  requireAdminCapabilityWhenAdmin(ACTIONS.EARTHQUAKE_EVENT_ENRICHMENT),
  AdminEarthquakeEventsController.runEnrichment,
);

/**
 * @swagger
 * /eq-events/{publicID}/summary:
 *   patch:
 *     summary: Set or update a custom event summary override
 *     tags: [EQ Events]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: publicID
 *         required: true
 *         schema:
 *           type: string
 *         description: The SeisComP public ID of the earthquake event
 *         example: "upri-event-001"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [text]
 *             properties:
 *               text:
 *                 type: string
 *                 description: The custom summary text to save for this event
 *                 example: "A magnitude 4.2 earthquake struck 40km north of Manila at a depth of 10km."
 *     responses:
 *       200:
 *         description: Event summary updated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: number
 *                   example: 0
 *                 message:
 *                   type: string
 *                   example: "Event summary updated successfully."
 *                 data:
 *                   type: object
 *                   properties:
 *                     text:
 *                       type: string
 *                       example: "A magnitude 4.2 earthquake struck 40km north of Manila at a depth of 10km."
 *                     editedAt:
 *                       type: string
 *                       format: date-time
 *                       example: "2024-01-15T08:30:00.000Z"
 *                     editedBy:
 *                       type: string
 *                       nullable: true
 *                       example: "admin_user"
 *       400:
 *         description: Missing or empty summary text.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: number
 *                   example: 1
 *                 message:
 *                   type: string
 *                   example: "Summary text is required and cannot be empty."
 *       403:
 *         description: Admin session cookie is required.
 *       404:
 *         description: Earthquake event was not found.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: number
 *                   example: 1
 *                 message:
 *                   type: string
 *                   example: "Event not found: upri-event-001"
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: number
 *                   example: 1
 *                 message:
 *                   type: string
 *                   example: "Failed to update event summary."
 *   delete:
 *     summary: Revert event summary to auto-generated, removing the override
 *     tags: [EQ Events]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: publicID
 *         required: true
 *         schema:
 *           type: string
 *         description: The SeisComP public ID of the earthquake event
 *         example: "upri-event-001"
 *     responses:
 *       200:
 *         description: Event summary reverted to auto-generated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: number
 *                   example: 0
 *                 message:
 *                   type: string
 *                   example: "Event summary reverted to auto-generated."
 *       403:
 *         description: Admin session cookie is required.
 *       404:
 *         description: Earthquake event was not found.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: number
 *                   example: 1
 *                 message:
 *                   type: string
 *                   example: "Event not found: upri-event-001"
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: number
 *                   example: 1
 *                 message:
 *                   type: string
 *                   example: "Failed to revert event summary."
 */
router.patch(
  '/:publicID/summary',
  getTokenFromCookie,
  verifyTokenWithRole(['admin', 'citizen']),
  requireAdminCsrfWhenAdmin,
  requireAdminCapabilityWhenAdmin(ACTIONS.EARTHQUAKE_EVENT_SUMMARY),
  (req, res, next) => (
    req.role === 'admin'
      ? AdminEarthquakeEventsController.updateSummary(req, res, next)
      : EQEventsController.patchEventSummary(req, res, next)
  ),
);

router.delete(
  '/:publicID/summary',
  getTokenFromCookie,
  verifyTokenWithRole(['admin', 'citizen']),
  requireAdminCsrfWhenAdmin,
  requireAdminCapabilityWhenAdmin(ACTIONS.EARTHQUAKE_EVENT_SUMMARY),
  (req, res, next) => (
    req.role === 'admin'
      ? AdminEarthquakeEventsController.revertSummary(req, res, next)
      : EQEventsController.deleteEventSummary(req, res, next)
  ),
);


module.exports = router;
