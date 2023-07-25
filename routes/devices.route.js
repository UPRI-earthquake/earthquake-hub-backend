/**
  * @swagger
  * components:
  *   schemas:
  *     Device:
  *       type: object
  *       properties:
  *         _id:
  *           type: string
  *           description: The auto-generated ObjectId of the device
  *         description:
  *           type: string
  *           description: The description of the device
  *         streamId:
  *           type: string
  *           description: The stream ID of the device (e.g. AM_RE722\.*\/MSEED)
  *         network:
  *           type: string
  *           description: The network of the device
  *         station:
  *           type: string
  *           description: The station of the device
  *         latitude:
  *           type: number
  *           description: The latitude of the device
  *         longitude:
  *           type: number
  *           description: The longitude of the device
  *         elevation:
  *           type: number
  *           description: The elevation of the device
  *         macAddress:
  *           type: string
  *           description: The MAC address of the device
  *         activity:
  *           type: string
  *           description: The activity status of the device (active, inactive, INTERNAL_ERROR)
  *         activityToggleTime:
  *           type: string
  *           format: date-time
  *           description: The time of the last activity toggle for the device
  */

const express = require('express');
const DeviceController = require('../controllers/device.controller');
const {
  getTokenFromCookie,
  getTokenFromBearer,
  verifyTokenWithRole
} = require('../middlewares/token.middleware')

const router = express.Router(); 

router.route('/all').get(
  DeviceController.getAllDeviceLocations
);


/**
  * @swagger
  * /device/mydevices:
  *   get:
  *     summary: Endpoint for getting list of devices associated with the authenticated user (citizen)
  *     tags:
  *       - Devices
  *     security:
  *       - cookieAuth: []
  *     responses:
  *       200:
  *         description: Successful response with a list of devices as objects in array
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               properties:
  *                 status:
  *                   type: number
  *                   description: Status code indicating success
  *                 message:
  *                   type: string
  *                   description: A descriptive message indicating success
  *                 payload:
  *                   type: array
  *                   description: Array of devices associated with the authenticated user
  *                   items:
  *                     type: object
  *                     properties:
  *                       network:
  *                         type: string
  *                         description: Network code of the device
  *                       station:
  *                         type: string
  *                         description: Station code of the device  
  *                       status:
  *                         type: string
  *                         description: Status of the device (Streaming, Not Streaming, Not Yet Linked)
  *                       statusSince:
  *                         type: string
  *                         description: Timestamp indicating when the device status changed (Not Available if Not Yet Linked)
  *       500:
  *         description: Internal server error
  */
router.route('/my-devices').get( 
  getTokenFromCookie,
  verifyTokenWithRole('citizen'),
  DeviceController.getDeviceList
);


/**
  * @swagger
  * /device/status:
  *   get:
  *     summary: Endpoint for getting the status of a specified device
  *     tags:
  *       - Devices
  *     parameters:
  *       - in: query
  *         name: network
  *         schema:
  *           type: string
  *         description: The network code of the device
  *         required: true
  *         example: "AM"
  *       - in: query
  *         name: station
  *         schema:
  *           type: string
  *         description: The station code of the device
  *         required: true
  *         example: "RE722"
  *     responses:
  *       200:
  *         description: Successful response with device network, station, status, and statusSince sent back as payload
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               properties:
  *                 status:
  *                   type: number
  *                   description: The HTTP status code
  *                 message:
  *                   type: string
  *                   description: A descriptive message
  *                 payload:
  *                   type: object
  *                   properties:
  *                     network:
  *                       type: string
  *                       description: The network code of the device
  *                     station:
  *                       type: string
  *                       description: The station code of the device
  *                     status:
  *                       type: string
  *                       description: The status of the device (Streaming, Not Streaming, Not Yet Linked)
  *                     statusSince:
  *                       type: string
  *                       description: Timestamp indicating when the device status changed (Not Available if Not Yet Linked)
  *       500:
  *         description: Station not found
  */
router.route('/status').get(
  DeviceController.getDeviceStatus
)


/**
  * @swagger
  * /device/add:
  *   post:
  *     summary: Endpoint for adding a device to the user's profile
  *     tags:
  *       - Devices
  *     security:
  *       - cookieAuth: []
  *     requestBody:
  *       description: Device data to be added
  *       required: true
  *       content:
  *         application/json:
  *           schema:
  *             type: object
  *             properties:
  *               network:
  *                 type: string
  *                 description: The network code of the device
  *               station:
  *                 type: string
  *                 description: The station code of the device
  *               latitude:
  *                 type: string
  *                 description: The latitude of the device (in degree coordinates)
  *               longitude:
  *                 type: string
  *                 description: The longitude of the device (in degree coordinates)
  *               elevation:
  *                 type: string
  *                 description: The elevation of the device (in meters)
  *           example:
  *             network: "AM"
  *             station: "R3B2D"
  *             latitude: "40.123456"
  *             longitude: "120.654321"
  *             elevation: "50"
  *     responses:
  *       200:
  *         description: Device added successfully
  *       400:
  *         description: Device is already added to the database
  *       403:
  *         description: Unauthorized - Invalid or missing token
  *       500:
  *         description: Internal server error
  */
router.route('/add').post( // Citizen users should have verified token to add devices to their profile via webapp
  getTokenFromCookie,
  verifyTokenWithRole('citizen'),
  DeviceController.addDevice
);


router.route('/link').post( // Sensor devices that will request for linking with a citizen acct requires bearer token
  getTokenFromBearer,
  verifyTokenWithRole('sensor'),
  DeviceController.linkDevice
);


module.exports = router;
