const express = require('express');
const NotificationsController = require('../controllers/notifications.controller');

const router = express.Router();

/**
  * @swagger
  * /notifications/subscribe:
  *   post:
  *     summary: Subscribe to web-push notifications.
  *     description: This endpoint should be accessed using client browser's webpush API
  *     tags: [Notifications]
  *     requestBody:
  *       required: true
  *       content:
  *         application/json:
  *           schema:
  *             type: object
  *             properties:
  *               endpoint:
  *                 type: string
  *                 format: uri
  *                 description: The push notification endpoint.
  *                 example: "https://updates.push.services.mozilla.com/wpush/v2/XXX"
  *               expirationTime:
  *                 type: string
  *                 format: date-time
  *                 nullable: true
  *                 description: The expiration time of the subscription (optional).
  *                 example: "2023-07-31T12:00:00Z"
  *               keys:
  *                 type: object
  *                 properties:
  *                   auth:
  *                     type: string
  *                     description: The authentication key for the subscription.
  *                     example: "qIwUJpYMw1E2Xa9vXOH-_Q"
  *                   p256dh:
  *                     type: string
  *                     description: The P-256 Diffie-Hellman public key for the subscription.
  *                     example: "BLuuTRceHGlpTdepbGlthyMlQM_I1WvqcLLONsg-zQ7aaAlRFO6DfmSSMGU"
  *             required:
  *               - endpoint
  *               - keys
  *     responses:
  *       201:
  *         description: Subscription created successfully.
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               properties:
  *                 status:
  *                   type: number
  *                   description: The status code for the response.
  *                   example: responseCodes.GENERIC_SUCCESS
  *                 message:
  *                   type: string
  *                   description: The message associated with the response.
  *                   example: "Subscription created"
  *       200:
  *         description: Subscription already exists.
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               properties:
  *                 status:
  *                   type: number
  *                   description: The status code for the response.
  *                   example: responseCodes.GENERIC_SUCCESS
  *                 message:
  *                   type: string
  *                   description: The message associated with the response.
  *                   example: "Subscription already exists"
  *       400:
  *         description: Bad request or internal error such as DB not accessible.
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               properties:
  *                 status:
  *                   type: number
  *                   description: The status code for the response.
  *                   example: responseCodes.GENERIC_ERROR
  *                 message:
  *                   type: string
  *                   description: The message associated with the response.
  *                   example: "Internal error encountered"
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
router.post('/subscribe', 
  NotificationsController.subscribe
)

module.exports = router

