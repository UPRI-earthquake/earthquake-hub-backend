const db = require('./mysqldb');
const helper = require('../helper');
const axios = require('axios');
const config =  require('../config')

// get magnitude, coord, time, 
async function getEventsList(startTime, endTime){
  const [rows, fields] = await db.query(
    `select 
       PEvent.publicID, 
       Origin.time_value as OT, 
       Origin.latitude_value,
       Origin.longitude_value,
       Origin.depth_value,
       Magnitude.magnitude_value, 
       Magnitude.type, 
       EventDescription.text 
     from 
       Origin,
       PublicObject as POrigin, 
       Event,
       PublicObject as PEvent, 
       Magnitude,
       PublicObject as PMagnitude,
       EventDescription
     where 
       Event._oid=PEvent._oid 
       and Origin._oid=POrigin._oid 
       and Magnitude._oid=PMagnitude._oid 
       and PMagnitude.publicID=Event.preferredMagnitudeID 
       and POrigin.publicID=Event.preferredOriginID
       and Event._oid=EventDescription._parent_oid
       and EventDescription.type='region name'
       and Origin.time_value >= ?
       and Origin.time_value <= ?`        
    , [startTime, endTime]); // automatic escaping when using placeholders
  const data = helper.emptyOrRows(rows);

  return data
}

async function addPlaces(eventsList){
  /* returns eventsList with .place */
  var updatedData = [];

  await Promise.all(eventsList.map(async (event) => {
    try{
      const result = await axios.get(
        `http://${config.nominatim.host}:${config.nominatim.port}`
         +'/reverse?format=jsonv2' 
         +`&lat=${event.latitude_value}&lon=${event.longitude_value}`
         +'&zoom=10'
      );
      var address = '';
      if (result.data.error){ address = result.data.error }
      else{
        address = result.data.address.city+", "
                  + result.data.address.county+", "
                  + result.data.address.state+", "
                  + result.data.address.region
        address = address
          .replace(/undefined(, )?/g,'') // remove undefined address levels
          .replace(/, $/, '') // remove dangling comma-space, if any
      }
    }catch(err){
      console.log('Catch: No nominatim')
      var address = 'Nominatim unavailable'
    }
    updatedData.push({
      ...event,
      place: address
    })
  }));

  return updatedData;
}

module.exports = {
  getEventsList,
  addPlaces,
}
