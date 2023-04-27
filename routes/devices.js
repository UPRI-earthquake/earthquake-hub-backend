const express = require('express');
const { addDevice } = require('../services/devices');

const deviceRouter = express.Router();

deviceRouter.post('/add', addDevice);

module.exports = addDevice;