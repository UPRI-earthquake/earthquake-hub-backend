const Device = require('../models/device.model');
const TunnelEnrollmentService = require('./tunnelEnrollment.service');

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function deviceId(device) {
  return `${String(device.network || '').toUpperCase()}_${String(device.station || '').toUpperCase()}`;
}

function summarizeDevices(devices, mappingByDeviceId) {
  const normalizedActivity = (device) => String(device.activity || '').toLowerCase();
  const isUnlinked = (device) => normalizedActivity(device) === 'unlinked' || !device.streamId || device.streamId === 'TO_BE_LINKED';
  return {
    total: devices.length,
    active: devices.filter((device) => ['active', 'streaming'].includes(normalizedActivity(device))).length,
    attention: devices.filter((device) => ['inactive', 'internal_error'].includes(normalizedActivity(device))).length,
    unlinked: devices.filter(isUnlinked).length,
    tunneled: devices.filter((device) => mappingByDeviceId.has(deviceId(device))).length,
    networks: [...new Set(devices.map((device) => String(device.network || '').toUpperCase()).filter(Boolean))].sort(),
  };
}

async function listDevices({ activity, attention, hasTunnel, includeSummary = false, isActive, network, search, limit = 25, offset = 0 } = {}) {
  const query = {};
  if (network) query.network = network;
  if (attention === true) query.activity = { $in: ['inactive', 'internal_error', 'INTERNAL_ERROR'] };
  else if (isActive === true) query.activity = { $in: ['active', 'streaming'] };
  else if (activity) query.activity = activity;
  if (search) {
    const expression = new RegExp(escapeRegex(search), 'i');
    query.$or = [{ network: expression }, { station: expression }, { streamId: expression }, { description: expression }];
  }

  const [devices, mappings, summaryDevices] = await Promise.all([
    Device.find(query)
      .sort({ network: 1, station: 1 })
      .select('network station streamId description latitude longitude elevation activity activityToggleTime macAddress')
      .lean(),
    TunnelEnrollmentService.listActiveMappings(),
    includeSummary
      ? Device.find({}).select('network station streamId activity').lean()
      : Promise.resolve([]),
  ]);
  const mappingByDeviceId = new Map((mappings || []).map((mapping) => [String(mapping.deviceId || '').toUpperCase(), mapping]));
  const rows = devices.map((device) => {
    const id = deviceId(device);
    return { ...device, deviceId: id, tunnel: mappingByDeviceId.get(id) || null };
  }).filter((device) => hasTunnel === undefined || Boolean(device.tunnel) === hasTunnel);

  return {
    devices: rows.slice(offset, offset + limit),
    total: rows.length,
    limit,
    offset,
    summary: includeSummary ? summarizeDevices(summaryDevices, mappingByDeviceId) : undefined,
  };
}

module.exports = { listDevices, summarizeDevices };
