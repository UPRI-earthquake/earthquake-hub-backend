// const db = require('./mysqldb');
// const helper = require('../helper');

// async function getStationLocations(){
//   const [rows, fields] = await db.query(
//        'SELECT code, latitude, longitude, description'
//     + ' FROM Station AS table1'
//     + ' WHERE end IS NULL' // metadata with no end is presently used
//   );
//   const data = helper.emptyOrRows(rows);
//   return data
// }

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

