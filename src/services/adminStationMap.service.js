const Device = require('../models/device.model');
const MAX_STATIONS = 2000;

function coordinate(value, bound) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= bound ? number : null;
}

async function getSnapshot() {
  const devices = await Device.find({})
    .sort({ network: 1, station: 1, _id: 1 })
    .limit(MAX_STATIONS + 1)
    .select('network station latitude longitude activity activityToggleTime')
    .lean();
  const stations = devices.slice(0, MAX_STATIONS).map((device) => ({
    deviceId: `${String(device.network || '').toUpperCase()}_${String(device.station || '').toUpperCase()}`,
    network: device.network,
    station: device.station,
    latitude: coordinate(device.latitude, 90),
    longitude: coordinate(device.longitude, 180),
    activity: device.activity || 'unknown',
    activityChangedAt: device.activityToggleTime || null,
  }));
  return {
    observedAt: new Date().toISOString(),
    source: 'hub-station-registry',
    scope: 'Registered coordinates and stored activity; not current connectivity',
    stations,
    truncated: devices.length > MAX_STATIONS,
    limit: MAX_STATIONS,
    missingCoordinates: stations.filter((station) => station.latitude === null || station.longitude === null).length,
  };
}
module.exports = { getSnapshot, coordinate, MAX_STATIONS };
