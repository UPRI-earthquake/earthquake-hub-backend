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

const Stations = require('../models/stations.model');

async function getStationLocations(){
  const response = await Stations.find();

  return response;
}

module.exports = {
  getStationLocations
}

