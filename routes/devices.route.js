const express = require('express');
const { addDevice, linkDevice, getDeviceList } = require('../services/devices.service');
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
deviceRouter.route('/listAll').get(
  getTokenFromCookie,
  verifyTokenWithRole('citizen'),
  getDeviceList
);

module.exports = deviceRouter;
