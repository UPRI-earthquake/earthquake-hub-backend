const Device = require('../models/device.model');
const TunnelEnrollmentService = require('./tunnelEnrollment.service');

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function deviceId(device) {
  return `${String(device.network || '').toUpperCase()}_${String(device.station || '').toUpperCase()}`;
}

async function listDevices({ activity, hasTunnel, network, search, limit = 25, offset = 0 } = {}) {
  const query = {};
  if (network) query.network = network;
  if (activity) query.activity = activity;
  if (search) {
    const expression = new RegExp(escapeRegex(search), 'i');
    query.$or = [{ network: expression }, { station: expression }, { streamId: expression }, { description: expression }];
  }

  const [devices, mappings] = await Promise.all([
    Device.find(query)
      .sort({ network: 1, station: 1 })
      .select('network station streamId description latitude longitude elevation activity activityToggleTime macAddress')
      .lean(),
    TunnelEnrollmentService.listActiveMappings(),
  ]);
  const mappingByDeviceId = new Map((mappings || []).map((mapping) => [String(mapping.deviceId || '').toUpperCase(), mapping]));
  const rows = devices.map((device) => {
    const id = deviceId(device);
    return { ...device, deviceId: id, tunnel: mappingByDeviceId.get(id) || null };
  }).filter((device) => hasTunnel === undefined || Boolean(device.tunnel) === hasTunnel);

  return { devices: rows.slice(offset, offset + limit), total: rows.length, limit, offset };
}

module.exports = { listDevices };
