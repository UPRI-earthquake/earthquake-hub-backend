const Device = require('../models/device.model');
const AdminHostTelemetryClient = require('./adminHostTelemetry.client');
const { reconcileInventory } = require('./adminInventoryReconciliation.service');
const {
  RUNBOOKS,
  UNAVAILABILITY_KINDS,
  buildUnavailability,
} = require('./adminCapabilities.service');

const HOST_EXECUTOR_UNAVAILABILITY = buildUnavailability({
  kind: UNAVAILABILITY_KINDS.IMPLEMENTATION_REQUIRED,
  title: 'Inventory host integration required',
  summary: 'Browser-initiated inventory execution is not implemented; the current workflow prepares safe host commands only.',
  prerequisites: [
    'Deploy a bounded inventory executor with a separate least-privilege host identity.',
    'Persist immutable plan identity, approval, bounded output, verification, and rollback evidence.',
    'Add backend authorization and audit coverage before enabling browser execution.',
  ],
  runbook: RUNBOOKS.ACTION_CAPABILITIES,
});

function stationLabel(device) {
  const network = String(device.network || '').toUpperCase();
  const station = String(device.station || '').toUpperCase();
  return `${network}.${station}`;
}

async function getWorkflow(req) {
  const [results, telemetry] = await Promise.all([Device.find({ network: { $exists: true }, station: { $exists: true } })
    .sort({ network: 1, station: 1 })
    .limit(2001)
    .select('network station description activity streamId latitude longitude elevation')
    .lean(), AdminHostTelemetryClient.getResource('seiscomp-inventory', req)]);
  const devices = results.slice(0, 2000);

  return {
    stationLimit: 2000,
    stationsTruncated: results.length > 2000,
    reconciliation: reconcileInventory(devices, telemetry),
    capabilities: {
      schemaVersion: '1.0',
      hostExecutorConfigured: false,
      applyEnabled: false,
      supportedModes: ['production-dry-run', 'compare-only'],
      hostExecutor: {
        available: false,
        mode: 'host-integration',
        reason: HOST_EXECUTOR_UNAVAILABILITY.summary,
        unavailability: HOST_EXECUTOR_UNAVAILABILITY,
      },
      apply: {
        available: false,
        mode: 'host-integration',
        reason: 'Inventory apply requires an approved, rollback-capable host workflow.',
        unavailability: HOST_EXECUTOR_UNAVAILABILITY,
      },
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
