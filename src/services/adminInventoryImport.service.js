const Device = require('../models/device.model');

function stationLabel(device) {
  const network = String(device.network || '').toUpperCase();
  const station = String(device.station || '').toUpperCase();
  return `${network}.${station}`;
}

async function getWorkflow() {
  const devices = await Device.find({ network: { $exists: true }, station: { $exists: true } })
    .sort({ network: 1, station: 1 })
    .select('network station description activity streamId')
    .lean();

  return {
    capabilities: {
      hostExecutorConfigured: false,
      applyEnabled: false,
      supportedModes: ['production-dry-run', 'compare-only'],
    },
    hostBoundary: [
      'inventory_import.py runs on the SeisComP deployment host, not in the backend container.',
      'Apply writes SeisComP inventory and station-key files and runs update-config; it requires a separately authorized host executor.',
    ],
    defaults: {
      network: 'AM',
      location: '00',
      bindingTemplate: 'inventory-bindings/rshake-am-ehz.key',
      source: 'raspberry-shake-fdsn',
    },
    stations: devices.map((device) => ({
      id: `${String(device.network).toUpperCase()}_${String(device.station).toUpperCase()}`,
      label: stationLabel(device),
      network: String(device.network).toUpperCase(),
      station: String(device.station).toUpperCase(),
      description: device.description || null,
      activity: device.activity || null,
      streamId: device.streamId || null,
    })),
  };
}

module.exports = { getWorkflow };
