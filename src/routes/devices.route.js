const express = require('express');
const DeviceController = require('../controllers/device.controller');
const {
  getTokenFromCookie,
  getTokenFromBearer,
  verifyTokenWithRole
} = require('../middlewares/token.middleware')

const router = express.Router(); 


/**
  * @swagger
  * /device/add:
  *   post:
  *     summary: Add a device to the user's account
  *     tags: [Device]
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
  *         description: Device added to records of the user account
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
  *                   example: "Successfully added device"
  *       '400':
  *         description: Device already belongs to an account
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
  *                   example: "Device details already used"
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
router.route('/add').post( // Citizen users should have verified token to add devices to their profile via webapp
  getTokenFromCookie,
  verifyTokenWithRole('citizen'),
  DeviceController.addDevice
);


/**
  * @swagger
  * /device/link:
  *   post:
  *     summary: Bind sensor's MAC address and streamId to the user's device record
  *     tags: [Device]
  *     security:
  *       - bearerAuth: []  # Indicates that bearer token in header is required
  *     requestBody:
  *       required: true
  *       description: Physical identification of the device/sensor
  *       content:
  *         application/json:
  *           schema:
  *             type: object
  *             properties:
  *               macAddress:
  *                 type: string
  *                 pattern: '^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$'
  *                 description: MAC address of the device (format XX:XX:XX:XX:XX:XX)
  *               streamId:
  *                 type: string
  *                 pattern: '^[A-Z]{2}_[A-Z0-9]{5}_\.\*\/MSEED$'
  *                 description: Stream ID of a device (format XX_XXXXX_.*&#8205;/MSEED)
  *     responses:
  *       '200':
  *         description: Device-account linking successful
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
  *                   example: 'Device-Account Linking Successful'
  *                 payload:
  *                   type: object
  *                   description: The payload containing device information.
  *                   properties:
  *                     deviceInfo:
  *                       type: object
  *                       properties:
  *                         network:
  *                           type: string
  *                           description: The network of the device.
  *                           example: 'AM'
  *                         station:
  *                           type: string
  *                           description: The code of the device station.
  *                           example: 'RE722'
  *                         longitude:
  *                           type: number
  *                           format: float
  *                           description: The longitude of the device location.
  *                           example: -122.4194
  *                         latitude:
  *                           type: number
  *                           format: float
  *                           description: The latitude of the device location.
  *                           example: 37.7749
  *                         elevation:
  *                           type: number
  *                           format: float
  *                           description: The elevation of the device location in meters.
  *                           example: 100.5
  *                         streamId:
  *                           type: string
  *                           description: The stream ID of the device.
  *                           pattern: '^[A-Z]{2}_[A-Z0-9]{5}_\.\*\/MSEED$'
  *       '400':
  *         description: Bad request
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               properties:
  *                 status:
  *                   type: number
  *                   description: The status code for the response.
  *                 message:
  *                   type: string
  *                   description: The message associated with the response.
  *             examples:  # Provide multiple examples for different error cases
  *               alreadyLinked:
  *                 value: 
  *                   status: responseCodes.GENERIC_ERROR
  *                   message: "Device is already linked to an existing account"
  *               usernameNotFound:
  *                 value: 
  *                   status: responseCodes.GENERIC_ERROR
  *                   message: "User not found"
  *               deviceNotFound:
  *                 value:
  *                   status: responseCodes.GENERIC_ERROR
  *                   message: "Device doesn't exist in the database!"
  *               deviceNotOwned:
  *                 value:
  *                   status: responseCodes.GENERIC_ERROR
  *                   message: "Device is not yet added to user's device list"
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
router.route('/link').post( // Sensor devices that will request for linking with a citizen acct requires bearer token
  getTokenFromBearer,
  verifyTokenWithRole('sensor'),
  DeviceController.linkDevice
);


/**
  * @swagger
  * /device/all:
  *   get:
  *     summary: Return all added (not necessarily linked) devices with their location
  *     tags: [Device]
  *     responses:
  *       '200':
  *         description: Success response with device locations
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               properties:
  *                 status:
  *                   type: number
  *                   description: The custom status code for the response as defined in responseCodes.js
  *                   example: responseCodes.GENERIC_SUCCESS
  *                 message:
  *                   type: string
  *                   description: The message associated with the response.
  *                   example: 'All device locations found'
  *                 payload:
  *                   type: array
  *                   description: An array of device objects containing device locations.
  *                   items:
  *                     type: object
  *                     properties:
  *                       network:
  *                         type: string
  *                         description: The network of the device.
  *                         example: 'AM'
  *                       code:
  *                         type: string
  *                         description: The code of the device station.
  *                         example: 'RE722'
  *                       latitude:
  *                         type: number
  *                         format: float
  *                         description: The latitude of the device location.
  *                         example: 37.7749
  *                       longitude:
  *                         type: number
  *                         format: float
  *                         description: The longitude of the device location.
  *                         example: -122.4194
  *                       description:
  *                         type: string
  *                         description: The description of the device.
  *                         example: "username's device"
  *       '400':
  *         description: Error response when no devices are found in the database.
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               properties:
  *                 status:
  *                   type: number
  *                   description: The custome status code for the response as defined in responseCodes.js
  *                   example: responseCodes.GENERIC_ERROR
  *                 message:
  *                   type: string
  *                   description: The message associated with the response.
  *                   example: 'No Devices found in DB!'
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
router.route('/all').get(
  DeviceController.getAllDeviceLocations
);


/**
  * @swagger
  * /device/my-devices:
  *   get:
  *     summary: Return list of devices belonging to the authenticated (citizen) user
  *     tags: [Device]
  *     security:
  *       - cookieAuth: []
  *     responses:
  *       '200':
  *         description: Success response with device locations
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               properties:
  *                 status:
  *                   type: number
  *                   description: The custom status code for the response as defined in responseCodes.js
  *                   example: responseCodes.GENERIC_SUCCESS
  *                 message:
  *                   type: string
  *                   description: The message associated with the response.
  *                   example: 'All device locations found'
  *                 payload:
  *                   type: array
  *                   description: An array of device objects
  *                   items:
  *                     type: object
  *                     properties:
  *                       network:
  *                         type: string
  *                         description: The network of the device.
  *                         example: 'AM'
  *                       station:
  *                         type: string
  *                         description: Station code of the device  
  *                         example: 'RE722'
  *                       status:
  *                         type: string
  *                         description: >
  *                           Status of device's data transmission
  *                            * `Streaming`      - ringserver is receiving data from device
  *                            * `Not Streaming`  - ringserver is NOT receiving data from device
  *                            * `Not Yet Linked` - device is added to account but physical sensor is not yet linked to the device record
  *                         example: 'Streaming'
  *                       statusSince:
  *                         type: string
  *                         description: Timestamp indicating when the device status changed (Not Available if Not Yet Linked)
  *                         example: "Fri, 14 Jul 2023 12:40:37 GMT"
  *       '403':
  *         description: When no token is present in sent cookie
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               properties:
  *                 status:
  *                   type: number
  *                   example: 403
  *                 message:
  *                   type: string
  *                   example: "Token in cookie missing"
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
router.route('/my-devices').get( 
  getTokenFromCookie,
  verifyTokenWithRole('citizen'),
  DeviceController.getOwnedDevices
);


/**
  * @swagger
  * /device/status:
  *   get:
  *     summary: Return the status of a specified device
  *     tags: [Device]
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
  *                   description: The custom status code for the response as defined in responseCodes.js
  *                   example: responseCodes.GENERIC_SUCCESS
  *                 message:
  *                   type: string
  *                   description: The message associated with the response.
  *                   example: 'All device locations found'
  *                 payload:
  *                   type: object
  *                   properties:
  *                     network:
  *                       type: string
  *                       description: The network of the device.
  *                       example: 'AM'
  *                     station:
  *                       type: string
  *                       description: Station code of the device  
  *                       example: 'RE722'
  *                     status:
  *                       type: string
  *                       description: >
  *                         Status of device's data transmission
  *                          * `Streaming`      - ringserver is receiving data from device
  *                          * `Not Streaming`  - ringserver is NOT receiving data from device
  *                          * `Not Yet Linked` - device is added to account but physical sensor is not yet linked to the device record
  *                       example: 'Streaming'
  *                     statusSince:
  *                       type: string
  *                       description: Timestamp indicating when the device status changed (Not Available if Not Yet Linked)
  *                       example: "Fri, 14 Jul 2023 12:40:37 GMT"
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
router.route('/status').get(
  DeviceController.getDeviceStatus
)


module.exports = router;
