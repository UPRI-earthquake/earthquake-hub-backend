const db = require('./db');
const helper = require('../helper');
const config = require('../config');

// get magnitude, coord, time, 
async function getEventsList(startTime, endTime){
  const [rows, fields] = await db.query(
    `select PEvent.publicID, Origin.time_value as OT, 
        Origin.latitude_value,Origin.longitude_value, Origin.depth_value,
        Magnitude.magnitude_value, Magnitude.type 
            from Origin,PublicObject as POrigin, 
                 Event, PublicObject as PEvent, 
                 Magnitude, PublicObject as PMagnitude 
            where 
                Event._oid=PEvent._oid 
                and Origin._oid=POrigin._oid 
                and Magnitude._oid=PMagnitude._oid 
                and PMagnitude.publicID=Event.preferredMagnitudeID 
                and POrigin.publicID=Event.preferredOriginID
                and Origin.time_value >= ?
                and Origin.time_value <= ?`        
    , [startTime, endTime]); // automatic escaping when using placeholders
  const data = helper.emptyOrRows(rows);
  return data
}

module.exports = {
  getEventsList
}
