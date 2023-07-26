const axios = require('axios');
const Joi = require('joi');
const EQEvents = require('../models/events.model');

async function getEventsList(startTime, endTime){
  const response = await events.find({
    OT: { $gte: startTime, $lte: endTime }
  });

  return response;
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
    let eventData;
    // check event data structure
    if (event._doc) {
      // if coming from mongoDB output
      eventData = event._doc;
    } else {
      // others
      eventData = event;
    }

    try{
      const result = await axios.get(
        // `https://earthquake.usgs.gov`
        `http://${process.env.GEOSERVE_HOST}:${process.env.GEOSERVE_PORT}`
        //`http://localhost:8080`
         +'/ws/geoserve/places.json?type=geonames&limit=1&maxradiuskm=250'
         +`&latitude=${eventData.latitude_value}&longitude=${eventData.longitude_value}`
      );
      var address = '';
      if (result.data.error){ address = result.data.error }
      else{
        [lon, lat, _] = result.data.geonames.features[0].geometry.coordinates
        event_lat = parseFloat(eventData.latitude_value)
        event_lon = parseFloat(eventData.longitude_value)
        dist = distKM(lat, lon, event_lat, event_lon)
        dir = direction(event_lat, event_lon, lat, lon)

        prop = result.data.geonames.features[0].properties
        address = dist + " km "
                  + dir + " of "
                  + prop.admin1_name+", "
                  + prop.country_name
        address = address
          .replace(/, $/, '') // remove dangling comma-space, if any

        // console.log(address)
      }
      updatedData.push({
        ...eventData,
        place: address
      })
    }catch(err){
      console.log('Catch: No Geoserve')
      var address = 'Unavailable'
      updatedData.push({
        ...eventData,
        place: address
      })
    }
    
  }));

  return updatedData;
}

async function addEQEvent(publicID, OT, latitude_value, longitude_value, depth_value, magnitude_value, eventType, text){
  if (eventType === 'UPDATE') { // if eventType === 'UPDATE', dont create new event entry
    const eventToUpdate = await EQEvents.findOne({ publicID: publicID });

    eventToUpdate.OT = OT,
    eventToUpdate.latitude_value = latitude_value,
    eventToUpdate.longitude_value = longitude_value,
    eventToUpdate.depth_value =  depth_value,
    eventToUpdate.magnitude_value = magnitude_value,
    eventToUpdate.type = eventType,
    eventToUpdate.text = text

    eventToUpdate.save();
  }
  else{ // if eventType === 'NEW', add new entry
    const newEQEvent = new EQEvents({
      publicID: publicID,
      OT: OT,
      latitude_value: latitude_value,
      longitude_value: longitude_value,
      depth_value: depth_value,
      magnitude_value: magnitude_value,
      type: eventType,
      text: text
    });
    await newEQEvent.save(); // save new entry to event collections
  }

  return 'success'
}

module.exports = {
  getEventsList,
  addPlaces,
  addEQEvent,
}
