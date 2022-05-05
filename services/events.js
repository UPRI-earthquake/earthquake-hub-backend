const db = require('./mysqldb');
const helper = require('../helper');
const axios = require('axios');
const config =  require('../config');

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

function distKM(lat1, lon1, lat2, lon2){
  earth_rad = 6371 //km
  lat1 = lat1 * (Math.PI / 180)
  lon1 = lon1 * (Math.PI / 180)
  lat2 = lat2 * (Math.PI / 180)
  lon2 = lon2 * (Math.PI / 180)

  // haversine formula
  dlon = lon2 - lon1
  dlat = lat2 - lat1
  a = Math.pow(Math.sin(dlat / 2), 2)
               + Math.cos(lat1) * Math.cos(lat2)
               * Math.pow(Math.sin(dlon / 2), 2);
  c = 2 * Math.asin(Math.sqrt(a));

  return (earth_rad*c).toFixed(0)
}

function direction(lat, lon, ref_lat, ref_lon){
  dlat = lat - ref_lat
  dlon = lon - ref_lon

  lat_dir = dlat > 0 ? "N" : "S"
  lon_dir = dlon > 0 ? "E" : "W"

  if (Math.abs(dlat) < 10 && Math.abs(dlon) > 10){ return lon_dir }
  else if (Math.abs(dlon) < 10 && Math.abs(dlat) > 10){ return lat_dir }
  else {return lat_dir + lon_dir}
}

async function addPlaces(eventsList){
  /* returns eventsList with .place */
  var updatedData = [];

  await Promise.all(eventsList.map(async (event) => {
    try{
      const result = await axios.get(
        `http://${config.geoserve.host}:${config.geoserve.port}`
        //`http://localhost:8080`
         +'/ws/geoserve/places.json?type=geonames&limit=1&maxradiuskm=250'
         +`&latitude=${event.latitude_value}&longitude=${event.longitude_value}`
      );
      var address = '';
      if (result.data.error){ address = result.data.error }
      else{
        [lon, lat, _] = result.data.geonames.features[0].geometry.coordinates
        event_lat = parseFloat(event.latitude_value)
        event_lon = parseFloat(event.longitude_value)
        dist = distKM(lat, lon, event_lat, event_lon)
        dir = direction(event_lat, event_lon, lat, lon)

        prop = result.data.geonames.features[0].properties
        address = dist + " km "
                  + dir + " of "
                  + prop.admin1_name+", "
                  + prop.country_name
        address = address
          .replace(/, $/, '') // remove dangling comma-space, if any

        console.log(address)
      }
    }catch(err){
      console.log('Catch: No Geoserve')
      var address = 'Unavailable'
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
