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

/**
 * @swagger
 * /device/status:
 *   get:
 *     summary: Get the status of a specified device
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
 *                   description: Data payload
 *       500:
 *         description: Station not found
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
 */


const express = require('express');
const { addDevice, linkDevice, getDeviceList, getDeviceStatus } = require('../services/devices.service');
const {
  getTokenFromCookie,
  getTokenFromBearer,
  verifyTokenWithRole
} = require('../middlewares/token.middleware')

const deviceRouter = express.Router();

// Citizen users should have verified token to add devices to their profile via webapp
deviceRouter.route('/add').post(
  getTokenFromCookie,
  verifyTokenWithRole('citizen'),
  addDevice
);

// Sensor devices that will request for linking with a citizen acct requires bearer token
deviceRouter.route('/link').post(
  getTokenFromBearer,
  verifyTokenWithRole('sensor'),
  linkDevice
);

// Citizen users that will request list of devices linked to his account should have verified token
deviceRouter.route('/list').get(
  getTokenFromCookie,
  verifyTokenWithRole('citizen'),
  getDeviceList
);

deviceRouter.route('/status').get( async (req, res) => {
  console.log('GET request on /device/status endpoint received');
  try {
    var data = await getDeviceStatus(req.query.network, req.query.station)
    res.status(200).json({ status: 200, message: "GET Device's Status Success", payload: data})
  }catch(err){
    res.status(500).json({ status: 500, message: 'Station not found' })
  }
})

module.exports = deviceRouter;
