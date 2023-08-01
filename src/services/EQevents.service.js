const axios = require('axios');
const Joi = require('joi');
const EQEvents = require('../models/events.model');

/***************************************************************************
  * getEventsList:
  *     Retrieves a list of earthquake events from the database that occurred within the specified time range.
  * 
  * Inputs:
  *     startTime: Date       // The start time of the desired time range to retrieve earthquake events.
  *     endTime: Date         // The end time of the desired time range to retrieve earthquake events.
  * 
  * Outputs:
  *     An array of earthquake event objects that occurred within the specified time range.
  * 
 ***************************************************************************/
async function getEventsList(startTime, endTime){
  const response = await EQEvents.find({
    OT: { $gte: startTime, $lte: endTime }
  });

  return response;
}

/***************************************************************************
  * distKM:
  *     Calculates the great-circle distance in kilometers between two points on the Earth's surface using the Haversine formula.
  * 
  * Inputs:
  *     lat1: number       // Latitude of the first point in degrees.
  *     lon1: number       // Longitude of the first point in degrees.
  *     lat2: number       // Latitude of the second point in degrees.
  *     lon2: number       // Longitude of the second point in degrees.
  * 
  * Returns:
  *     The calculated great-circle distance in kilometers between the two points rounded to the nearest whole number.
  * 
  * Note:
  *     - The function returns the distance in kilometers rounded to the nearest whole number.
 ***************************************************************************/
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

/***************************************************************************
  * direction:
  *     Calculates the cardinal direction from a reference point to a target point on the Earth's surface.
  * 
  * Inputs:
  *     lat: number          // Latitude of the target point in degrees.
  *     lon: number          // Longitude of the target point in degrees.
  *     ref_lat: number      // Latitude of the reference point in degrees.
  *     ref_lon: number      // Longitude of the reference point in degrees.
  * 
  * Returns:
  *     A string representing the cardinal direction from the reference point to the target point.
  * 
  * Note:
  *     - Based on the differences in latitude and longitude, the function determines the cardinal direction from the reference
  *       point to the target point (e.g., "N" for North, "S" for South, "E" for East, "W" for West).
  *     - The function returns a string representing the calculated cardinal direction. If the target point is within 10 degrees
  *       of latitude or longitude from the reference point, it will return only the direction in which the greater difference
  *       lies (e.g., if the latitude difference is greater, it will return "N" or "S"; if the longitude difference is greater,
  *       it will return "E" or "W"; if both differences are greater, it will return a combination of both directions, e.g., "NE").
 ***************************************************************************/
function direction(lat, lon, ref_lat, ref_lon){
  dlat = lat - ref_lat
  dlon = lon - ref_lon

  lat_dir = dlat > 0 ? "N" : "S"
  lon_dir = dlon > 0 ? "E" : "W"

  if (Math.abs(dlat) < 10 && Math.abs(dlon) > 10){ return lon_dir }
  else if (Math.abs(dlon) < 10 && Math.abs(dlat) > 10){ return lat_dir }
  else {return lat_dir + lon_dir}
}

/***************************************************************************
  * addPlacesAttribute:
  *     Retrieves the location information for earthquake events and adds a 'place' attribute to each event in the eventsList.
  * 
  * Inputs:
  *     eventsList: Array     // An array of earthquake event objects representing a list of events.
  * 
  * Outputs:
  *     An array of earthquake event objects with an added 'place' attribute for each event.
  * 
  * Returns:
  *     A Promise that resolves to an array of earthquake event objects with an added 'place' attribute.
  * 
  * Note:
  *     - This function is asynchronous and returns a Promise that resolves to the updatedData array.
  *     - The function takes an array of earthquake event objects as input (eventsList) and iterates through each event to
  *       retrieve its location information.
  *     - The location information is obtained by making an HTTP GET request to a geoserve API using the latitude and longitude
  *       values of each event.
  *     - The retrieved location information is used to construct a 'place' attribute for each event, which represents the
  *       approximate location description (e.g., distance and direction from a reference point) of the earthquake event.
  *     - The function then returns the updatedData array, where each event object contains the 'place' attribute.
  *     - In case the geoserve API request fails, the function will use 'Unavailable' as the place attribute value for the event.
 ***************************************************************************/
async function addPlacesAttribute(eventsList){
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

/***************************************************************************
  * addEQEvent:
  *     Adds or updates an earthquake event entry in the database based on the provided event details (from SeisComP).
  * 
  * Inputs:
  *     publicID: string          // The unique public identifier of the earthquake event.
  *     OT: Date                  // The origin time of the earthquake event.
  *     latitude_value: number    // The latitude coordinate of the earthquake event.
  *     longitude_value: number   // The longitude coordinate of the earthquake event.
  *     depth_value: number       // The depth of the earthquake event.
  *     magnitude_value: number   // The magnitude of the earthquake event.
  *     eventType: string         // The type of event ('NEW' for a new event or 'UPDATE' for updating an existing event).
  *     text: string              // Location description related to the earthquake event.
  * 
  * Outputs:
  *     "success":                if the earthquake event was successfully added or updated in the database.
  * 
  * Returns:
  *     A Promise that resolves to a string indicating the result status of the event addition or update.
  * 
  * Note:
  *     - The function first checks the provided eventType. If it is 'UPDATE', the function finds the existing event in the
  *       database based on the publicID and updates its information with the provided details (OT, latitude_value, etc.).
  *       If the eventType is 'NEW', the function creates a new earthquake event entry in the database with the provided details.
 ***************************************************************************/
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
  addPlacesAttribute,
  addEQEvent,
}
