const axios = require('axios');
const Joi = require('joi');

const events = require('../models/events.model');

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
    try{
      const result = await axios.get(
        `http://${process.env.GEOSERVE_HOST}:${process.env.GEOSERVE_PORT}`
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
      publicID: event.publicID,
      OT: event.OT,
      latitude_value: event.latitude_value,
      longitude_value: event.longitude_value,
      depth_value: event.depth_value,
      magnitude_value: event.magnitude_value,
      type: event.type,
      text: event.text,
      place: address
    });
  }));

  return updatedData;
}


const addEventSchema = Joi.object().keys({
  publicID: Joi.string().required(),
  OT: Joi.date().required(),
  latitude_value: Joi.string().regex(/^[-+]?(?:90(?:\.0{1,6})?|(?:[0-8]?\d(?:\.\d{1,6})?))$/).required(),
  longitude_value: Joi.string().regex(/^[-+]?(?:180(?:\.0{1,6})?|(?:1[0-7]\d|0?\d{1,2})(?:\.\d{1,6})?)$/).required(),
  depth_value: Joi.string().regex(/^\d+(\.\d+)?$/).required(),
  magnitude_value: Joi.string().regex(/^\d+(\.\d+)?$/).required(),
  type: Joi.string().required(),
  text: Joi.string().required(),
});

const addEvent = async (req, res, next) => {
  console.log("Event Posted");

  try {
    const result = addEventSchema.validate(req.body)
    if(result.error){
      console.log(result.error.details[0].message)
      res.status(400).json({ status: 400, message: result.error.details[0].message});
      return;
    }

    const newEvent = new events({
      publicID: result.value.publicID,
      OT: result.value.OT,
      latitude_value: result.value.latitude_value,
      longitude_value: result.value.longitude_value,
      depth_value: result.value.depth_value,
      magnitude_value: result.value.magnitude_value,
      type: result.value.type,
      text: result.value.text
    });
    await newEvent.save(); // save new entry to event collections

    console.log(`Add event successful`);
    return res.status(200).json({ status: 200, message: "New Event Added" });
  } catch (error) {
    console.log(`Add event unsuccessful: \n ${error}`);
    res.status(500).json({ message: `Error adding event: ${error}` })
  }
}

module.exports = {
  getEventsList,
  addPlaces,
  addEvent,
}
