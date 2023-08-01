/**
  * @swagger
  * components:
  *   schemas:
  *     Event:
  *       type: object
  *       properties:
  *         _id:
  *           type: string
  *           description: Auto-generated ObjectId (from SeisComP) of the event
  *         publicID:
  *           type: string
  *           description: SeisComP public ID of the event
  *         OT:
  *           type: string
  *           format: date-time
  *           description: Origin time of the event
  *         latitude_value:
  *           type: number
  *           description: Latitude value of the event
  *         longitude_value:
  *           type: number
  *           description: Longitude value of the event
  *         depth_value:
  *           type: number
  *           description: Depth value of the event
  *         magnitude_value:
  *           type: number
  *           description: Magnitude value of the event
  *         type:
  *           type: string
  *           description: >
  *              * `NEW`  - Newly created event object from SeisComP
  *              * `UPDATE` - An update of previously created event object
  *         text:
  *           type: string
  *           description: SeisComP's derived place name for the event
  *         place:
  *           type: string
  *           description: An attribute added later-on via geoserve API
  *       example:
  *         _id: 6151ec04b417ad001ff7d346
  *         publicID: event123
  *         OT: '2022-01-01T00:00:00.000Z'
  *         latitude_value: 40.123456
  *         longitude_value: -120.654321
  *         depth_value: 10
  *         magnitude_value: 5.7
  *         type: earthquake
  *         text: Mindoro, Philippines
  */

const express = require('express');
const router = express.Router();
const EQEventsController = require('../controllers/EQevents.controller');

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
router.get('/',
  EQEventsController.getEQEvents
);

module.exports = router;
