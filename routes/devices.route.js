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
