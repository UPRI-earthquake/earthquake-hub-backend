const express = require('express');
const router = express.Router();

const MessagingMiddleware = require('../middlewares/messaging.middleware')
const MessagingController = require('../controllers/messaging.controller')

const restrictedPath = '/restricted'; // NGINX will deny public access to this path

router.get('/',
  MessagingMiddleware.SSEFormatting,
  MessagingMiddleware.missedEventsResender,
  MessagingController.setupSSEConnection
);


/**
  * @swagger
  * /messaging/restricted/new-event:
  *   post:
  *     summary: (RESTRICTED ACCESS) Add new EQevent as message in SSE, entry in DB, and notif to subscribed clients
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
  *     summary: (RESTRICTED ACCESS) Add new PICK as message in SSE
  *     tags: [Messaging]
  *     requestBody:
  *       description: Pick data to be added
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
  *         description: Pick added successfully
  *       500:
  *         description: Internal server error
  */
router.post(`${restrictedPath}/new-pick`,
  MessagingController.newPick
);


module.exports = router
