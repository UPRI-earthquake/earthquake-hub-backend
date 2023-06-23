const device = require('../models/device.model');
const account = require('../models/account.model');

async function getStationLocations(){
  const devices = await device.find();

  const response = devices.map(_device => ({
    network: _device.network,
    code: _device.station,
    latitude: _device.latitude,
    longitude: _device.longitude,
    description: `'s device` //TODO: populate device to username
  }));

  return response;
}

module.exports = {
  getStationLocations
}

