const express = require('express');
const router = express.Router();

const MessagingMiddleware = require('../middlewares/messaging.middleware')
const MessagingController = require('../controllers/messaging.controller')

const restrictedPath = '/restricted'; // NGINX will deny public access to this path

/**
  * @swagger
  * /messaging:
  *   get:
  *     tags: [Messaging]
  *     summary: SSE endpoint to stream SC_EVENT, SC_PICK, and STATION_STATUS messages to the client.
  *     description: |
  *       - This endpoint streams events to the client using Server-Sent Events (SSE).
  *       - The endpoint uses the `text/event-stream` content type.
  *       - Events are sent as STRINGS in the format: `event: <event_name>\ndata: <event_obj>\\id: <timestamp>\n\n`.
  *       - `event` can be SC_EVENT, SC_PICK, or STATION_STATUS (station activity updates)
  *     responses:
  *       200:
  *         description: OK
  *         content:
  *           text/event-stream:
  *             schema:
  *               type: string
  *               description: The SSE data stream. Note that 'place' attribute can be Unavailable if geoserve api isn't online.
  *             examples:
  *               # These are sent as streams!
  *               earthquakeEvent:
  *                 value: |
  *                   "event": "SC_EVENT"
  *                   "data": {
  *                     "eventType": "NEW",
  *                     "publicID": "TEST4",
  *                     "OT": "2023-06-09T14:39:21.000Z",
  *                     "latitude_value": 21.317,
  *                     "longitude_value": 118.998,
  *                     "depth_value": 1.1,
  *                     "magnitude_value": 6.1,
  *                     "text": "Cagayan Valley, Philippines",
  *                     "method": "LOCSAT",
  *                     "last_modification": "2023-06-09T14:39:21.000Z",
  *                     "place": "Unavailable"
  *                   }
  *                   "id": 1690534975637
  *               pickEvent:
  *                 value: |
  *                   "event": "SC_PICK"
  *                   "data": {
  *                     "networkCode": "AM",
  *                     "stationCode": "RE722",
  *                     "timestamp": "2023-06-27T05:58:21.000Z"
  *                   }
  *                   "id": 1690534975472
  *               stationStatus:
  *                 value: |
  *                   "event": "STATION_STATUS"
  *                   "data": {
  *                     "network": "AM",
  *                     "station": "RE722",
  *                     "activity": "active",
  *                     "status": "Streaming",
  *                     "statusSince": "2025-10-09T02:31:22.000Z"
  *                   }
  *                   "id": 1690534976000
  */
router.get('/',
  MessagingMiddleware.SSEFormatting,
  MessagingMiddleware.missedEventsResender,
  MessagingController.setupSSEConnection
  //                 value: '{"event": "SC_PICK","data": {"networkCode": "AM","stationCode": "RE722","timestamp": "2023-06-27T05:58:21.000Z"},"id": 1690534975472}'
);


/**
  * @swagger
  * /messaging/restricted/new-event:
  *   post:
  *     summary: Add new EQevent as message in SSE, entry in DB, and notif to subscribed clients.
  *     description: >
  *       !! Access to this endpoint is restricted to trusted network only, this is done via
  *       the NGINX reverse-proxy (in deployment environment).
  *     tags: [Messaging]
  *     requestBody:
  *       description: Event data to be added
  *       required: true
  *       content:
  *         application/json:
  *           schema:
  *             $ref: '#/components/schemas/Event'
  *           example:
  *             eventType: NEW
  *             publicID: TEST4
  *             OT: '2023-06-09T14:39:21.000Z'
  *             latitude_value: 21.317
  *             longitude_value: 118.998
  *             depth_value: 1.1
  *             magnitude_value: 6.1
  *             text: Cagayan Valley, Philippines
  *             method: LOCSAT
  *             last_modification: '2023-06-09T14:39:21.000Z'
  *     responses:
  *       200:
  *         description: Event added successfully
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               properties:
  *                 status:
  *                   type: number
  *                   example: responseCodes.GENERIC_SUCCESS
  *                 message:
  *                   type: string
  *                   example: "New event sent to SSE, added to DB, and published as notif (if >minMag)"
  *
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
router.post(`${restrictedPath}/new-event`,
  MessagingController.newEQEvent
);


/**
  * @swagger
  * /messaging/restricted/new-pick:
  *   post:
  *     summary: Add new PICK as message to SSE.
  *     description: >
  *       !! Access to this endpoint is restricted to trusted network only, this is done via
  *       the NGINX reverse-proxy (in deployment environment).
  *     tags: [Messaging]
  *     requestBody:
  *       description: Pick data from processor like SeisComP 
  *       required: true
  *       content:
  *         application/json:
  *           schema:
  *             type: object
  *             properties:
  *               networkCode:
  *                 type: string
  *                 description: The network code of the device
  *               stationCode:
  *                 type: string
  *                 description: The station code of the device
  *               timestamp:
  *                 type: string
  *                 format: $date-time
  *                 description: The timestamp when the pick was recorded
  *           example:
  *             networkCode: AM
  *             stationCode: RE722
  *             timestamp: '2023-06-27T05:58:21.000Z'
  *     responses:
  *       200:
  *         description: Pick received successfully
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               properties:
  *                 status:
  *                   type: number
  *                   example: responseCodes.GENERIC_SUCCESS
  *                 message:
  *                   type: string
  *                   example: "Pick received"
  *
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
router.post(`${restrictedPath}/new-pick`,
  MessagingController.newPick
);

/**
  * @swagger
  * /messaging/restricted/rshake-alert:
  *   post:
  *     summary: Receive sender-originated RShake alert payloads and dispatch email notifications.
  *     description: >
  *       Restricted endpoint for trusted sender integrations. Stores no state by default;
  *       validates payload then dispatches alert emails to opted-in account owners and admin monitors.
  *       If `RSHAKE_ALERT_SHARED_SECRET` is configured, caller must send
  *       `X-RShake-Alert-Secret` header.
  *     tags: [Messaging]
  *     requestBody:
  *       required: true
  *       content:
  *         application/json:
  *           schema:
  *             type: object
  *             properties:
  *               schemaVersion:
  *                 type: string
  *               messageId:
  *                 type: string
  *               type:
  *                 type: string
  *                 enum: [device.alert, device.recovery, device.heartbeat]
  *               occurredAt:
  *                 type: string
  *                 format: date-time
  *               device:
  *                 type: object
  *               summary:
  *                 type: string
  *     responses:
  *       202:
  *         description: Alert accepted
  *       400:
  *         description: Validation error
  *       502:
  *         description: Email delivery error
  */
router.post(`${restrictedPath}/rshake-alert`,
  MessagingMiddleware.requireRshakeAlertSecret,
  MessagingController.newRshakeAlert
);


/**
  * @swagger
  * /messaging/restricted/station-status:
  *   post:
  *     summary: Publish a station status event to SSE (admin/test only)
  *     description: >
  *       !! Access to this endpoint is restricted to trusted network only (via reverse-proxy).
  *       Emits a `STATION_STATUS` message on the `/messaging` SSE stream and optionally updates
  *       the matching device's `activity` and `activityToggleTime` in MongoDB.
  *     tags: [Messaging]
  *     requestBody:
  *       required: true
  *       content:
  *         application/json:
  *           schema:
  *             type: object
  *             properties:
  *               network:
  *                 type: string
  *                 example: AM
  *               station:
  *                 type: string
  *                 example: RE722
  *               activity:
  *                 type: string
  *                 description: Canonical activity value
  *                 enum: [active, inactive]
  *               status:
  *                 type: string
  *                 description: Optional human label; will be derived from activity if omitted
  *                 enum: [Streaming, Not Streaming]
  *               statusSince:
  *                 type: string
  *                 format: date-time
  *                 description: Optional toggle time; defaults to now
  *           example:
  *             network: AM
  *             station: RE722
  *             activity: active
  *             status: Streaming
  *             statusSince: '2025-10-09T02:31:22.000Z'
  *     responses:
  *       200:
  *         description: Status broadcasted
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               properties:
  *                 status:
  *                   type: number
  *                 message:
  *                   type: string
  */
router.post(`${restrictedPath}/station-status`,
  MessagingController.newStationStatus
);


module.exports = router
