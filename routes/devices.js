const express = require('express');
const { addDevice, linkDevice } = require('../services/devices');

const deviceRouter = express.Router();

deviceRouter.post('/add', addDevice);
deviceRouter.post('/link', linkDevice);

module.exports = deviceRouter;