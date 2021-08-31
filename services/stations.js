const db = require('./db');
const helper = require('../helper');
const config = require('../config');

async function getStationLocations(){
  const [rows, fields] = await db.query(
       'SELECT code, latitude, longitude'
    + ' FROM Station AS table1'
    + ' WHERE start = (SELECT MAX(start)'
    +                ' FROM Station AS table2'
    +                ' WHERE table2.code = table1.code)'
  );
  const data = helper.emptyOrRows(rows);
  return data
}

module.exports = {
  getStationLocations
}

