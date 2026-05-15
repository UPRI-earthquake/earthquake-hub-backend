const axios = require('axios');
const Joi = require('joi');
const EQEvents = require('../models/events.model');
const Device = require('../models/device.model');
const puppeteer = require('puppeteer-core');

const FDSNWS_BASE = process.env.FDSNWS_DATASELECT_URL || 'https://earthquake.science.upd.edu.ph/fdsnws/dataselect/1/query';
const FDSN_NETWORK = process.env.FDSNWS_NETWORK || 'AM';
const FDSN_LOCATION = process.env.FDSNWS_LOCATION || '00';
const FDSN_CHANNEL = process.env.FDSNWS_CHANNEL || 'EHZ';
const FDSN_WINDOW_SECONDS = Number(process.env.FDSNWS_WINDOW_SECONDS || 30);
const ONLINE_STATION_REFINEMENT_DELAY_MS = Number(process.env.ONLINE_STATION_REFINEMENT_DELAY_MS || 0);

const turfHelpers  = require('@turf/helpers');
const turfDistance = require('@turf/distance'); 

function _positiveNumberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/************************ 
 * 
 * constants for scraping additional information in the web
 * -USGS
 * -PHIVOLCS
 * 
************************/
const PHIVOLCS_HOME_URL = 'https://earthquake.phivolcs.dost.gov.ph/';
const PHIVOLCS_TZ_OFFSET = 'GMT+0800';
const DEFAULT_USGS_WINDOW_HOURS = 12;
const CATALOG_MATCH_THRESHOLDS = {
  high:   { timeMinutes: 2,  distanceKm: 100, magnitude: 0.5 },
  medium: { timeMinutes: 5,  distanceKm: 250, magnitude: 1.0 },
  low:    { timeMinutes: 10, distanceKm: 500, magnitude: 1.5 },
};
const SOURCE_DISPLAY_METADATA = {
  phivolcs: {
    sourceLabel: 'PHIVOLCS',
    sourceIconUrl: `${PHIVOLCS_HOME_URL}favicon.ico`,
  },
  usgs: {
    sourceLabel: 'USGS',
    sourceIconUrl: 'https://earthquake.usgs.gov/favicon.ico',
  },
};
const CATALOG_SOURCE_NAMES = Object.freeze(Object.keys(SOURCE_DISPLAY_METADATA));
const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MAX_ENRICHMENT_ATTEMPTS  = Number(process.env.MAX_ENRICHMENT_ATTEMPTS  || 3);
const ENRICHMENT_MIN_AGE_HOURS = Number(process.env.ENRICHMENT_MIN_AGE_HOURS || 12);
const ENRICHMENT_BATCH_SIZE = _positiveNumberEnv('ENRICHMENT_BATCH_SIZE', 25);
const USGS_REQUEST_TIMEOUT_MS = _positiveNumberEnv('USGS_REQUEST_TIMEOUT_MS', 15_000);

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

async function getEventByPublicID(publicID) {
  return EQEvents.findOne({ publicID });
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
  // Resolve nearest currently active stations inline during ingest. This
  // reflects device activity at processing time, not guaranteed waveform
  // availability for the event time window.
  let onlineStations = [];
  try {
    onlineStations = await getNearestActiveStations(latitude_value, longitude_value);
  } catch (err) {
    console.error(`addEQEvent [${publicID}]: onlineStations lookup failed - ${err.message}`);
  }

  const existingEvent = await EQEvents.findOne({ publicID }, { depth_value: 1, last_modification: 1 }).lean();

  // Ignore stale updates: only newer last_modification may overwrite existing
  // event details. This prevents out-of-order proxy messages from regressing
  // event values.
  if (existingEvent && last_modification && existingEvent.last_modification) {
    const incomingMs = new Date(last_modification).getTime();
    const existingMs = new Date(existingEvent.last_modification).getTime();
    if (Number.isFinite(incomingMs) && Number.isFinite(existingMs) && incomingMs < existingMs) {
      return 'success';
    }
  }

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
      onlineStations,
      ...(last_modification ? { last_modification: last_modification } : {}),
    },
    $setOnInsert: {
      publicID,
      pendingCatalogSources: CATALOG_SOURCE_NAMES,
      catalogEnrichmentAttempts: {},
      catalogEnrichmentStatus: Object.fromEntries(CATALOG_SOURCE_NAMES.map((source) => [source, 'pending'])),
    },
  };

  await EQEvents.updateOne(filter, update, { upsert: true });
  scheduleOnlineStationsRefinement(publicID);
  return 'success';
}

function scheduleOnlineStationsRefinement(publicID) {
  if (!publicID) return;

  const timer = setTimeout(() => {
    updateOnlineStationsForEvent(publicID).catch((err) => {
      console.error(`addEQEvent [${publicID}]: onlineStations refinement failed - ${err.message}`);
    });
  }, ONLINE_STATION_REFINEMENT_DELAY_MS);
  if (typeof timer.unref === 'function') timer.unref();
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
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

/***************************************************************************
  * getNearestActiveStations:
  *     Sorts currently active stations by distance to an epicenter. No FDSN
  *     waveform check is performed.
  *
  * Inputs:
  *     latitude_value: number
  *     longitude_value: number
  *
  * Outputs:
  *     An array of station code strings sorted nearest-first.
  *
 ***************************************************************************/
async function getNearestActiveStations(latitude_value, longitude_value) {
  if (latitude_value == null || longitude_value == null) {
    return [];
  }

  const activeDevices = await Device.find({ activity: 'active' }).lean();
  if (activeDevices.length === 0) {
    return [];
  }

  const usableDevices = activeDevices.filter(
    (device) => device.station && device.longitude != null && device.latitude != null,
  );

  const nearestStations = getNearestStations(
    usableDevices,
    longitude_value,
    latitude_value,
    {
      point: turfHelpers.point,
      distance: turfDistance.default,
    },
  );

  return nearestStations.map((station) => String(station.station));
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
    return response.status >= 200 && response.status < 300;
  } catch (_error) {
    return null;
  }
}

async function getEventOnlineStationsResult(event, stationDevices, turf) {
  const eventTime = new Date(event.OT);
  if (Number.isNaN(eventTime.getTime())) {
    return { onlineStations: [], checkedCount: 0, failedCheckCount: 0 };
  }

  const startTime = formatFdsnTime(eventTime);
  const endTime = formatFdsnTime(new Date(eventTime.getTime() + (FDSN_WINDOW_SECONDS * 1000)));

  const checks = await Promise.all(
    stationDevices.map(async (device) => ({
      device,
      hasRecording: await checkStationRecording(device.station, startTime, endTime),
    })),
  );

  const failedCheckCount = checks.filter((entry) => entry.hasRecording === null).length;
  const recordedDevices = checks
    .filter((entry) => entry.hasRecording === true)
    .map((entry) => entry.device);

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
    checkedCount: checks.length,
    failedCheckCount,
  };
}

async function getEventOnlineStations(event, stationDevices, turf) {
  const result = await getEventOnlineStationsResult(event, stationDevices, turf);
  return result.onlineStations;
}

async function updateOnlineStationsForEvent(publicID) {
  const turf = await import('@turf/turf');

  const event = await EQEvents.findOne({ publicID }).lean();
  if (!event || event.longitude_value == null || event.latitude_value == null) {
    return { matchedCount: 0, modifiedCount: 0, usableDevicesCount: 0, onlineStations: [] };
  }

  const devices = await Device.find({}).lean();
  const usableDevices = devices.filter(
    (device) => device.station && device.longitude != null && device.latitude != null,
  );
  const refinement = await getEventOnlineStationsResult(event, usableDevices, turf);
  if (refinement.checkedCount > 0 && refinement.failedCheckCount === refinement.checkedCount) {
    return {
      matchedCount: 0,
      modifiedCount: 0,
      usableDevicesCount: usableDevices.length,
      onlineStations: event.onlineStations || [],
      skipped: true,
      reason: 'all_station_recording_checks_failed',
    };
  }

  const onlineStations = refinement.onlineStations;
  const result = await EQEvents.updateOne({ publicID }, { $set: { onlineStations } });

  return {
    matchedCount: result.matchedCount,
    modifiedCount: result.modifiedCount,
    usableDevicesCount: usableDevices.length,
    onlineStations,
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

  const eventsWithCoords = events.filter(event => event.longitude_value != null && event.latitude_value != null);

  if (eventsWithCoords.length === 0) {
    return { matchedCount: 0, modifiedCount: 0, usableDevicesCount: 0 };
  }

  const usableDevices = devices.filter(
    (device) => device.station && device.longitude != null && device.latitude != null,
  );

  const eventStationPairs = [];
  let skippedCount = 0;
  for (let index = 0; index < eventsWithCoords.length; index += 1) {
    const event = eventsWithCoords[index];
    const refinement = await getEventOnlineStationsResult(event, usableDevices, turf);
    if (refinement.checkedCount > 0 && refinement.failedCheckCount === refinement.checkedCount) {
      skippedCount += 1;
      continue;
    }

    eventStationPairs.push({ eventId: event._id, onlineStations: refinement.onlineStations });
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
      skippedCount,
      sampleOnlineStations: null,
    };
  }

  const result = await EQEvents.bulkWrite(operations);

  const sampleEvent = await EQEvents.findOne({}).lean();

  return {
    matchedCount: result.matchedCount,
    modifiedCount: result.modifiedCount,
    usableDevicesCount: usableDevices.length,
    skippedCount,
    sampleOnlineStations: sampleEvent ? sampleEvent.onlineStations : null
  };
}


/*****
 * 
 * addAdditionalInformation helper functions
 * 
 *****/

// ─────────────────────────────────────────────────────────────────────────
// addAdditionalInformation helpers
// ─────────────────────────────────────────────────────────────────────────

function _parseNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function _parseDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function _toRounded(value, digits = 3) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function _getDistanceKm(lat1, lon1, lat2, lon2) {
  const from = turfHelpers.point([lon1, lat1]);
  const to   = turfHelpers.point([lon2, lat2]);
  return turfDistance.default(from, to, { units: 'kilometers' });
}

function _computeScore(timeDiffMinutes, distanceKm, magDiff, floorBoost = 0) {
  return timeDiffMinutes * 4 + distanceKm * 1.8 + magDiff * 25 + floorBoost;
}

function _getCatalogMatchQuality(candidate) {
  const timeDiffMinutes = _parseNumber(candidate.timeDifferenceMinutes);
  const distanceKm      = _parseNumber(candidate.distanceKm);
  const magDiff         = _parseNumber(candidate.magnitudeDifference);

  if (timeDiffMinutes === null) return null;

  const low = CATALOG_MATCH_THRESHOLDS.low;
  if (timeDiffMinutes > low.timeMinutes) return null;

  const distanceExceedsLow = distanceKm === null || distanceKm > low.distanceKm;
  const magnitudeExceedsLow = magDiff === null || magDiff > low.magnitude;
  if (distanceExceedsLow && magnitudeExceedsLow) return null;

  if (
    timeDiffMinutes <= CATALOG_MATCH_THRESHOLDS.high.timeMinutes &&
    distanceKm !== null &&
    distanceKm <= CATALOG_MATCH_THRESHOLDS.high.distanceKm &&
    magDiff !== null &&
    magDiff <= CATALOG_MATCH_THRESHOLDS.high.magnitude
  ) {
    return 'high';
  }

  if (
    timeDiffMinutes <= CATALOG_MATCH_THRESHOLDS.medium.timeMinutes &&
    distanceKm !== null &&
    distanceKm <= CATALOG_MATCH_THRESHOLDS.medium.distanceKm &&
    magDiff !== null &&
    magDiff <= CATALOG_MATCH_THRESHOLDS.medium.magnitude
  ) {
    return 'medium';
  }

  return 'low';
}

function _selectCatalogMatch(candidates) {
  return candidates
    .map((candidate) => {
      const matchQuality = _getCatalogMatchQuality(candidate);
      return matchQuality ? { ...candidate, matchQuality } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score)[0] ?? null;
}

function _getSourceDisplayMetadata(source) {
  return SOURCE_DISPLAY_METADATA[source] ?? {};
}

function _mapToObject(value) {
  if (!value) return {};
  if (value instanceof Map) return Object.fromEntries(value.entries());
  if (typeof value === 'object') return value;
  return {};
}

function _normalizeCatalogSources(additionalInformation) {
  if (Array.isArray(additionalInformation)) {
    return additionalInformation
      .filter((entry) => entry && typeof entry === 'object' && entry.source)
      .map((entry) => ({ ...entry, source: String(entry.source).toLowerCase() }));
  }

  if (additionalInformation && typeof additionalInformation === 'object') {
    return Object.entries(additionalInformation)
      .filter(([, value]) => value && typeof value === 'object')
      .map(([source, value]) => ({
        source: String(value.source || source).toLowerCase(),
        ...value,
      }));
  }

  return [];
}

function _mergeCatalogSource(existingSources, source, match) {
  const normalizedSource = String(source).toLowerCase();
  const remaining = _normalizeCatalogSources(existingSources)
    .filter((entry) => entry.source !== normalizedSource);

  if (!match) return remaining;
  return [...remaining, { ...match, source: normalizedSource }];
}

function _getSourceAttempt(event, source) {
  const attempts = _mapToObject(event.catalogEnrichmentAttempts);
  return Number(attempts[source] || 0);
}

function _getPendingCatalogSources(event) {
  const pending = Array.isArray(event.pendingCatalogSources)
    ? event.pendingCatalogSources.map((source) => String(source).toLowerCase())
    : [];

  const eligiblePending = pending.filter(
    (source) => CATALOG_SOURCE_NAMES.includes(source) && _getSourceAttempt(event, source) < MAX_ENRICHMENT_ATTEMPTS,
  );

  if (eligiblePending.length > 0) return [...new Set(eligiblePending)];

  // Backward compatibility for old documents that have not been migrated yet.
  if (event.upForEnrichment === true && (event.enrichmentAttempts ?? 0) < MAX_ENRICHMENT_ATTEMPTS) {
    return CATALOG_SOURCE_NAMES.filter((source) => _getSourceAttempt(event, source) < MAX_ENRICHMENT_ATTEMPTS);
  }

  return [];
}

function _buildReferenceEvent(event) {
  return {
    OT:        _parseDate(event.OT),
    latitude:  _parseNumber(event.latitude_value),
    longitude: _parseNumber(event.longitude_value),
    magnitude: _parseNumber(event.magnitude_value),
  };
}

function _validateReferenceEvent(ref) {
  const missing = [];
  if (!ref.OT)               missing.push('OT');
  if (ref.latitude  === null) missing.push('latitude_value');
  if (ref.longitude === null) missing.push('longitude_value');
  if (ref.magnitude === null) missing.push('magnitude_value');
  return missing;
}

function _getEnrichmentEligibilityFilter() {
  const cutoff = new Date(Date.now() - ENRICHMENT_MIN_AGE_HOURS * 60 * 60 * 1000);
  return {
    OT: { $lte: cutoff },
    $or: [
      { pendingCatalogSources: { $exists: true, $ne: [] } },
      {
        upForEnrichment: true,
        enrichmentAttempts: { $lt: MAX_ENRICHMENT_ATTEMPTS },
      },
    ],
  };
}

async function countEligibleEnrichmentEvents() {
  return EQEvents.countDocuments(_getEnrichmentEligibilityFilter());
}

function _buildPhivolcsUrl(year, month) {
  const now = new Date();
  const isCurrentMonth = year === now.getUTCFullYear() && month === now.getUTCMonth() + 1;
  if (isCurrentMonth) return PHIVOLCS_HOME_URL;
  return (
    'https://earthquake.phivolcs.dost.gov.ph/EQLatest-Monthly/' +
    `${year}/${year}_${MONTH_NAMES[month]}.html`
  );
}

function _parsePhivolcsDateTime(dateTime) {
  if (!dateTime) return null;
  const cleaned = dateTime.replace(' - ', ' ');
  const parsed  = new Date(`${cleaned} ${PHIVOLCS_TZ_OFFSET}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function _normalizePhivolcsMatch(rawEvent, ref) {
  const eventTime          = _parsePhivolcsDateTime(rawEvent.dateTime);
  const timeDiffMs         = eventTime ? Math.abs(eventTime.getTime() - ref.OT.getTime()) : null;
  const timeDiffMinutes    = timeDiffMs === null ? Infinity : timeDiffMs / 60_000;
  const distanceKm         = _getDistanceKm(ref.latitude, ref.longitude, rawEvent.latitude, rawEvent.longitude);
  const magDiff            = Math.abs(rawEvent.magnitude - ref.magnitude);
  const score              = _computeScore(timeDiffMinutes, distanceKm, magDiff);

  return {
    source:                 'phivolcs',
    ..._getSourceDisplayMetadata('phivolcs'),
    dateTime:               rawEvent.dateTime,
    detailUrl:              rawEvent.detailUrl,
    hasFeltIntensity:       rawEvent.hasFeltIntensity,
    time:                   eventTime ? eventTime.toISOString() : null,
    latitude:               rawEvent.latitude,
    longitude:              rawEvent.longitude,
    depthKm:                rawEvent.depthKm,
    magnitude:              rawEvent.magnitude,
    location:               rawEvent.location,
    distanceKm:             _toRounded(distanceKm, 2),
    timeDifferenceMinutes:  Number.isFinite(timeDiffMinutes) ? _toRounded(timeDiffMinutes, 2) : null,
    magnitudeDifference:    _toRounded(magDiff, 3),
    score:                  _toRounded(score, 2),
  };
}

async function _getPhivolcsMonthlyRows(page, cache, year, month) {
  const cacheKey = `${year}-${String(month).padStart(2, '0')}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const url = _buildPhivolcsUrl(year, month);
  console.log(`PHIVOLCS: loading ${MONTH_NAMES[month]} ${year} from ${url}`);

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  const rows = await page.evaluate(() => {
    const results = [];
    const allRows = document.querySelectorAll('tr:has(td.auto-style91), tr:has(td.auto-style100)');
    allRows.forEach((row) => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 6) return;
      const dateCell = cells[0];
      const anchor   = dateCell.querySelector('a');
      results.push({
        dateTime:       anchor ? anchor.innerText.trim() : dateCell.innerText.trim(),
        detailUrl:      anchor ? anchor.href : null,
        hasFeltIntensity: dateCell.classList.contains('auto-style100'),
        latitude:       parseFloat(cells[1].innerText.trim()),
        longitude:      parseFloat(cells[2].innerText.trim()),
        depthKm:        parseFloat(cells[3].innerText.trim()),
        magnitude:      parseFloat(cells[4].innerText.trim()),
        location:       cells[5].innerText.trim(),
      });
    });
    return results;
  });

  const filtered = rows.filter(
    (r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude) && Number.isFinite(r.magnitude)
  );
  cache.set(cacheKey, filtered);
  return filtered;
}

async function _fetchPhivolcsMatch(ref, page, cache) {
  const year  = ref.OT.getUTCFullYear();
  const month = ref.OT.getUTCMonth() + 1;
  const rows  = await _getPhivolcsMonthlyRows(page, cache, year, month);

  const candidates = rows
    .map((row) => _normalizePhivolcsMatch(row, ref));

  return _selectCatalogMatch(candidates);
}

async function _fetchUsgsMatch(ref, windowHours = DEFAULT_USGS_WINDOW_HOURS) {
  const windowMs   = windowHours * 60 * 60 * 1000;
  const startTime  = new Date(ref.OT.getTime() - windowMs);
  const endTime    = new Date(ref.OT.getTime() + windowMs);
  const minMag     = Math.max(ref.magnitude - 1.5, -2);
  const maxMag     = Math.min(ref.magnitude + 1.5, 10);
  const url        = new URL('https://earthquake.usgs.gov/fdsnws/event/1/query');

  url.searchParams.set('format',       'geojson');
  url.searchParams.set('starttime',    startTime.toISOString());
  url.searchParams.set('endtime',      endTime.toISOString());
  url.searchParams.set('minmagnitude', String(_toRounded(minMag, 2)));
  url.searchParams.set('maxmagnitude', String(_toRounded(maxMag, 2)));
  url.searchParams.set('orderby',      'time');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), USGS_REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url.toString(), { signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`USGS request timed out after ${USGS_REQUEST_TIMEOUT_MS} ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) throw new Error(`USGS request failed: HTTP ${response.status}`);

  const result     = await response.json();
  const candidates = result.features
    .map((feature) => {
      const [longitude, latitude, depth] = feature.geometry.coordinates;
      const magnitude        = _parseNumber(feature.properties.mag);
      if (!Number.isFinite(magnitude)) return null;
      const eventTime        = new Date(feature.properties.time);
      const timeDiffMinutes  = Math.abs(eventTime.getTime() - ref.OT.getTime()) / 60_000;
      const distanceKm       = _getDistanceKm(ref.latitude, ref.longitude, latitude, longitude);
      const magDiff          = Math.abs(magnitude - ref.magnitude);
      const latFloor         = Math.floor(ref.latitude)  === Math.floor(latitude);
      const lonFloor         = Math.floor(ref.longitude) === Math.floor(longitude);
      const floorBoost       = latFloor && lonFloor ? -8 : 0;
      const score            = _computeScore(timeDiffMinutes, distanceKm, magDiff, floorBoost);

      return {
        source:                'usgs',
        ..._getSourceDisplayMetadata('usgs'),
        id:                    feature.id,
        title:                 feature.properties.title,
        place:                 feature.properties.place,
        url:                   feature.properties.url,
        detail:                feature.properties.detail,
        queryUrl:              url.toString(),
        time:                  eventTime.toISOString(),
        latitude,
        longitude,
        depth,
        magnitude,
        distanceKm:            _toRounded(distanceKm, 2),
        timeDifferenceMinutes: _toRounded(timeDiffMinutes, 2),
        magnitudeDifference:   _toRounded(magDiff, 3),
        latitudeFloorMatch:    latFloor,
        longitudeFloorMatch:   lonFloor,
        score:                 _toRounded(score, 2),
      };
    })
    .filter(Boolean);

  return _selectCatalogMatch(candidates);
}

const CATALOG_SOURCE_ADAPTERS = {
  phivolcs: {
    fetchMatch: (ref, context) => _fetchPhivolcsMatch(ref, context.page, context.phivolcsCache),
  },
  usgs: {
    fetchMatch: (ref) => _fetchUsgsMatch(ref),
  },
};

/***************************************************************************
  * addAdditionalInformation:
  *     Batch-enriches earthquake events with matching entries from PHIVOLCS
  *     (via headless browser) and USGS (via REST API).
  *
  *     Only events satisfying ALL of the following are processed:
  *       - upForEnrichment is true
  *       - OT is older than ENRICHMENT_MIN_AGE_HOURS (gives external catalogs
  *         time to publish their entries before we query them)
  *       - enrichmentAttempts < MAX_ENRICHMENT_ATTEMPTS (prevents indefinite
  *         retries on persistent infrastructure failures)
  *
  *     After each event is processed:
  *       - On success:           upForEnrichment = false, attempts incremented
  *       - On missing core data: upForEnrichment = false, attempts incremented
  *       - On transient error:   upForEnrichment stays true, attempts incremented
  *         (will be retried next run until MAX_ENRICHMENT_ATTEMPTS is reached)
  *
  *     Once enrichmentAttempts reaches MAX_ENRICHMENT_ATTEMPTS the event is
  *     excluded from the query entirely, so it is never processed again.
  *
  * Outputs:
  *     An object with modifiedCount, skippedCount, exhaustedCount, and totalProcessed.
  *
 ***************************************************************************/
async function addAdditionalInformation() {
  const browser = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--in-process-gpu',
      '--headless',
    ],
  });

  const safeResult = (promise) =>
    promise
      .then((value) => ({ ok: true, value }))
      .catch((error) => ({ ok: false, error }));

  try {
    const page          = await browser.newPage();
    const phivolcsCache = new Map();

    const events = await EQEvents.find(_getEnrichmentEligibilityFilter())
      .sort({ OT: 1 })
      .limit(ENRICHMENT_BATCH_SIZE)
      .lean();

    console.log(
      `addAdditionalInformation: processing ${events.length} event(s) ` +
      `(minAge=${ENRICHMENT_MIN_AGE_HOURS}h, maxAttempts=${MAX_ENRICHMENT_ATTEMPTS}, ` +
      `batchSize=${ENRICHMENT_BATCH_SIZE})`
    );

    let modifiedCount  = 0;
    let skippedCount   = 0;
    let exhaustedCount = 0;
    let completedCount = 0;
    let partialCount = 0;
    let noMatchCount = 0;
    let failedSourceCount = 0;

    for (let i = 0; i < events.length; i += 1) {
      const event         = events[i];
      const ref           = _buildReferenceEvent(event);
      const missingFields = _validateReferenceEvent(ref);
      const label         = event.publicID ?? String(event._id);
      const pendingSources = _getPendingCatalogSources(event);
      const sourceAttempts = _mapToObject(event.catalogEnrichmentAttempts);
      const sourceStatus = _mapToObject(event.catalogEnrichmentStatus);

      process.stdout.write(
        `[${i + 1}/${events.length}] ${label} (sources: ${pendingSources.join(', ') || 'none'}) ... `
      );

      if (pendingSources.length === 0) {
        process.stdout.write('skipped (no eligible pending source)\n');
        skippedCount += 1;
        continue;
      }

      // ── Missing core fields: no point retrying, close it out ──────────
      if (missingFields.length > 0) {
        pendingSources.forEach((source) => {
          sourceStatus[source] = 'no_match';
          sourceAttempts[source] = (sourceAttempts[source] || 0) + 1;
        });
        await EQEvents.updateOne(
          { _id: event._id },
          {
            $set: {
              additionalInformation: _normalizeCatalogSources(event.additionalInformation),
              pendingCatalogSources: [],
              catalogEnrichmentAttempts: sourceAttempts,
              catalogEnrichmentStatus: sourceStatus,
              upForEnrichment: false,
            },
            $inc: { enrichmentAttempts: 1 },
          },
        );
        process.stdout.write(`skipped (missing: ${missingFields.join(', ')})\n`);
        skippedCount  += 1;
        modifiedCount += 1;
        continue;
      }

      // ── Normal enrichment attempt ──────────────────────────────────────
      try {
        const sourceResults = await Promise.all(
          pendingSources.map(async (source) => {
            const adapter = CATALOG_SOURCE_ADAPTERS[source];
            const result = await safeResult(adapter.fetchMatch(ref, { page, phivolcsCache }));
            return { source, ...result };
          }),
        );

        let additionalInformation = _normalizeCatalogSources(event.additionalInformation);
        const remainingPendingSources = new Set(
          Array.isArray(event.pendingCatalogSources)
            ? event.pendingCatalogSources.map((source) => String(source).toLowerCase())
            : pendingSources,
        );
        let savedCount = 0;
        let sourceFailureCount = 0;

        sourceResults.forEach((result) => {
          const source = result.source;
          sourceAttempts[source] = (sourceAttempts[source] || 0) + 1;

          if (!result.ok) {
            sourceFailureCount += 1;
            console.error(`  ${source.toUpperCase()} lookup failed: ${result.error.message}`);
            if (sourceAttempts[source] >= MAX_ENRICHMENT_ATTEMPTS) {
              sourceStatus[source] = 'failed';
              remainingPendingSources.delete(source);
              exhaustedCount += 1;
            } else {
              sourceStatus[source] = 'pending';
            }
            return;
          }

          remainingPendingSources.delete(source);
          if (result.value) {
            additionalInformation = _mergeCatalogSource(additionalInformation, source, result.value);
            sourceStatus[source] = 'done';
            savedCount += 1;
          } else {
            additionalInformation = _mergeCatalogSource(additionalInformation, source, null);
            sourceStatus[source] = 'no_match';
          }
        });

        failedSourceCount += sourceFailureCount;

        const pendingCatalogSources = [...remainingPendingSources].filter(
          (source) => CATALOG_SOURCE_NAMES.includes(source) && _getSourceAttempt(
            { catalogEnrichmentAttempts: sourceAttempts },
            source,
          ) < MAX_ENRICHMENT_ATTEMPTS,
        );
        const allCompleted = sourceFailureCount === 0;

        await EQEvents.updateOne(
          { _id: event._id },
          {
            $set: {
              additionalInformation,
              pendingCatalogSources,
              catalogEnrichmentAttempts: sourceAttempts,
              catalogEnrichmentStatus: sourceStatus,
              upForEnrichment: pendingCatalogSources.length > 0,
            },
            $inc: { enrichmentAttempts: 1 },
          },
        );

        const statusNote = allCompleted ? '' : ' (partial — will retry failed source)';
        if (!allCompleted) {
          partialCount += 1;
        } else if (savedCount === 0) {
          noMatchCount += 1;
        } else {
          completedCount += 1;
        }
        process.stdout.write(`saved ${savedCount}/2 match(es)${statusNote}\n`);
        modifiedCount += 1;
      } catch (err) {
        // Outer catch handles unexpected errors (e.g. DB write failure).
        // Per-source errors are now handled above via safeResult.
        pendingSources.forEach((source) => {
          sourceAttempts[source] = (sourceAttempts[source] || 0) + 1;
          if (sourceAttempts[source] >= MAX_ENRICHMENT_ATTEMPTS) {
            sourceStatus[source] = 'failed';
          }
        });
        const remainingPendingSources = pendingSources.filter(
          (source) => sourceAttempts[source] < MAX_ENRICHMENT_ATTEMPTS,
        );
        const updateFields = {
          $set: {
            additionalInformation: _normalizeCatalogSources(event.additionalInformation),
            pendingCatalogSources: remainingPendingSources,
            catalogEnrichmentAttempts: sourceAttempts,
            catalogEnrichmentStatus: sourceStatus,
            upForEnrichment: remainingPendingSources.length > 0,
          },
          $inc: { enrichmentAttempts: 1 },
        };

        if (remainingPendingSources.length === 0) {
          exhaustedCount += 1;
          process.stdout.write(`error (attempt limit reached, giving up) -> ${err.message}\n`);
        } else {
          process.stdout.write(`error (will retry) -> ${err.message}\n`);
        }

        await EQEvents.updateOne({ _id: event._id }, updateFields);
        modifiedCount += 1;
      }
    }

    console.log(
      `\naddAdditionalInformation done. ` +
      `modified=${modifiedCount} completed=${completedCount} partial=${partialCount} ` +
      `noMatch=${noMatchCount} skipped=${skippedCount} exhausted=${exhaustedCount} ` +
      `failedSources=${failedSourceCount}`
    );
    return {
      modifiedCount,
      completedCount,
      partialCount,
      noMatchCount,
      skippedCount,
      exhaustedCount,
      failedSourceCount,
      totalProcessed: events.length,
      batchSize: ENRICHMENT_BATCH_SIZE,
    };
  } finally {
    await browser.close();
  }
}
 
module.exports = {
  getEventsList,
  getEventByPublicID,
  addPlacesAttribute,
  addEQEvent,
  updateOnlineStationsForEvent,
  updateOnlineStations,
  addAdditionalInformation,
  countEligibleEnrichmentEvents,
  _test: {
    getCatalogMatchQuality: _getCatalogMatchQuality,
    selectCatalogMatch: _selectCatalogMatch,
    normalizeCatalogSources: _normalizeCatalogSources,
    mergeCatalogSource: _mergeCatalogSource,
    getPendingCatalogSources: _getPendingCatalogSources,
  },
};
