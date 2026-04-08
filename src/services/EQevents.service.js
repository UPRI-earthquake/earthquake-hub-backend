const axios = require('axios');
const Joi = require('joi');
const EQEvents = require('../models/events.model');
const Device = require('../models/device.model');

const FDSNWS_BASE = process.env.FDSNWS_DATASELECT_URL || 'https://earthquake.science.upd.edu.ph/fdsnws/dataselect/1/query';
const FDSN_NETWORK = process.env.FDSNWS_NETWORK || 'AM';
const FDSN_LOCATION = process.env.FDSNWS_LOCATION || '00';
const FDSN_CHANNEL = process.env.FDSNWS_CHANNEL || 'EHZ';
const FDSN_WINDOW_SECONDS = Number(process.env.FDSNWS_WINDOW_SECONDS || 30);

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
  * distKMFloat:
  *     Calculates the great-circle distance in kilometers between two points on the Earth's surface using the Haversine formula.
  * 
  * Inputs:
  *     lat1: number       // Latitude of the first point in degrees.
  *     lon1: number       // Longitude of the first point in degrees.
  *     lat2: number       // Latitude of the second point in degrees.
  *     lon2: number       // Longitude of the second point in degrees.
  * 
  * Returns:
  *     The calculated great-circle distance in kilometers between the two points as a float rounded to one decimal place.
  * 
 ***************************************************************************/

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
      // console.log('Catch: No Geoserve')
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
async function addEQEvent(
  publicID,
  OT,
  latitude_value,
  longitude_value,
  depth_value,
  magnitude_value,
  eventType,
  text,
  last_modification,
){
  // Idempotent upsert by publicID. This prevents duplicates when a previous
  // bug or out-of-order messages would otherwise create separate NEW/UPDATE
  // documents for the same quake. The unique index on publicID enforces this
  // at the database level as well.
  const filter = { publicID };
  const update = {
    $set: {
      OT,
      latitude_value,
      longitude_value,
      depth_value,
      magnitude_value,
      type: eventType,
      text,
      ...(last_modification ? { last_modification: last_modification } : {}),
    },
    $setOnInsert: { publicID },
  };

  await EQEvents.updateOne(filter, update, { upsert: true });
  return 'success';
}

function formatFdsnTime(date) {
  const iso = date.toISOString();
  return iso.slice(0, 19);
}

function getNearestStations(devices, epicenterLng, epicenterLat, turf) {
  const epicenter = turf.point([epicenterLng, epicenterLat]);

  return devices
    .map((device) => {
      const stationPoint = turf.point([device.longitude, device.latitude]);
      const distanceKm = turf.distance(epicenter, stationPoint, { units: 'kilometers' });

      return {
        ...device,
        distanceKm: Math.round(distanceKm * 10) / 10,
      };
    })
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 3);
}

async function checkStationRecording(stationCode, startTime, endTime) {
  const params = new URLSearchParams({
    starttime: startTime,
    endtime: endTime,
    network: FDSN_NETWORK,
    station: stationCode,
    location: FDSN_LOCATION,
    channel: FDSN_CHANNEL,
    nodata: '404',
  });

  const url = `${FDSNWS_BASE}?${params.toString()}`;

  try {
    const response = await axios.get(url, {
      timeout: 10000,
      validateStatus: () => true,
    });
    return response.status !== 404;
  } catch (_error) {
    return false;
  }
}

async function getEventOnlineStations(event, stationDevices, turf) {
  const eventTime = new Date(event.OT);
  if (Number.isNaN(eventTime.getTime())) {
    return {
      onlineStations: [],
      respondingStations: [],
    };
  }

  const startTime = formatFdsnTime(eventTime);
  const endTime = formatFdsnTime(new Date(eventTime.getTime() + (FDSN_WINDOW_SECONDS * 1000)));

  const checks = await Promise.all(
    stationDevices.map(async (device) => ({
      device,
      hasRecording: await checkStationRecording(device.station, startTime, endTime),
    })),
  );

  const recordedDevices = checks
    .filter((entry) => entry.hasRecording)
    .map((entry) => entry.device);

  const respondingStations = recordedDevices
    .map((device) => device.station)
    .filter(Boolean)
    .map((station) => String(station));

  const nearestStations = getNearestStations(
    recordedDevices,
    event.longitude_value,
    event.latitude_value,
    turf,
  );

  const onlineStations = nearestStations
    .map((station) => station.station)
    .filter(Boolean)
    .map((station) => String(station));

  return {
    onlineStations,
    respondingStations,
  };
}

/***************************************************************************
  * updateOnlineStations:
  *     Updates all events with their closest online stations based on geographic distance.
  * 
  * Outputs:
  *     An object with matchedCount, modifiedCount, and usableDevicesCount.
  * 
 ***************************************************************************/
async function updateOnlineStations() {
  const turf = await import('@turf/turf');

  const [events, devices] = await Promise.all([
    EQEvents.find({}).lean(),
    Device.find({}).lean()
  ]);

  console.log(`[updateOnlineStations] Loaded ${events.length} events and ${devices.length} devices`);

  const eventsWithCoords = events.filter(event => event.longitude_value != null && event.latitude_value != null);
  console.log(`[updateOnlineStations] Events with coordinates: ${eventsWithCoords.length}`);

  if (eventsWithCoords.length === 0) {
    console.log('[updateOnlineStations] No events with coordinates found. Skipping station checks.');
    return { matchedCount: 0, modifiedCount: 0, usableDevicesCount: 0 };
  }

  const usableDevices = devices.filter(
    (device) => device.station && device.longitude != null && device.latitude != null,
  );
  console.log(`[updateOnlineStations] Usable station devices: ${usableDevices.length}`);

  const eventStationPairs = [];
  for (let index = 0; index < eventsWithCoords.length; index += 1) {
    const event = eventsWithCoords[index];
    const eventLabel = event.publicID || String(event._id);
    // console.log(
    //   `[updateOnlineStations] Processing event ${index + 1}/${eventsWithCoords.length}: ${eventLabel} (OT: ${event.OT})`,
    // );

    const { onlineStations, respondingStations } = await getEventOnlineStations(event, usableDevices, turf);
    // console.log(
    //   `[updateOnlineStations] Non-404 stations for ${eventLabel}: ${JSON.stringify(respondingStations)}`,
    // );
    console.log(
      `[updateOnlineStations] Completed event ${index + 1}/${eventsWithCoords.length}: ${eventLabel} -> onlineStations=${JSON.stringify(onlineStations)}`,
    );

    eventStationPairs.push({ eventId: event._id, onlineStations });
  }

  const operations = eventStationPairs.map(({ eventId, onlineStations }) => ({
    updateOne: {
      filter: { _id: eventId },
      update: {
        $set: {
          onlineStations,
        },
      },
    },
  }));

  if (operations.length === 0) {
    return {
      matchedCount: 0,
      modifiedCount: 0,
      usableDevicesCount: usableDevices.length,
      sampleOnlineStations: null,
    };
  }

  const result = await EQEvents.bulkWrite(operations);

  console.log('Bulk write result:', result);

  // Verify by logging a sample event's onlineStations
  const sampleEvent = await EQEvents.findOne({}).lean();
  if (sampleEvent) {
    console.log('Sample event onlineStations:', sampleEvent.onlineStations);
  }

  return {
    matchedCount: result.matchedCount,
    modifiedCount: result.modifiedCount,
    usableDevicesCount: usableDevices.length,
    sampleOnlineStations: sampleEvent ? sampleEvent.onlineStations : null
  };
}

module.exports = {
  getEventsList,
  addPlacesAttribute,
  addEQEvent,
  updateOnlineStations,
};
