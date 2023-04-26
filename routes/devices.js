const express = require('express');
const { addDevice } = require('../services/devices');

const deviceRouter = express.Router();

deviceRouter.post('/', addDevice);

module.exports = addDevice;