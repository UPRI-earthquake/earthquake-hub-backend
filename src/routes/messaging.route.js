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
  *     summary: SSE endpoint to stream SC_PICK or SC_EVENT messages to the client.
  *     description: |
  *       - This endpoint streams events to the client using Server-Sent Events (SSE).
  *       - The endpoint uses the `text/event-stream` content type.
  *       - Events are sent as STRINGS in the format: `event: <event_name>\ndata: <event_obj>\\id: <timestamp>\n\n`.
  *     responses:
  *       200:
  *         description: OK
  *         content:
  *           text/event-stream:
  *             schema:
  *               type: string
  *               description: The SSE data stream.
  *             examples:
  *               # These are sent as streams!
  *               earthquakeEvent:
  *                 value: |
  *                   "event": "SC_EVENT"
  *                   "data": {
  *                     "networkCode": "AM",
  *                     "stationCode": "RE722",
  *                     "timestamp": "2023-06-27T05:58:21.000Z"
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


module.exports = router
