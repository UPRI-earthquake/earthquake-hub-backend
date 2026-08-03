const AdminHostTelemetryClient = require('./adminHostTelemetry.client');
const { buildOperationalState } = require('./adminOperationalState.service');

const GATED_OPERATIONS = Object.freeze([
  {
    id: 'seiscomp.reload',
    label: 'Reload SeisComP configuration',
    available: false,
    reason: 'The allowlisted host operations runner is not configured.',
  },
  {
    id: 'seiscomp.restart',
    label: 'Restart SeisComP processing',
    available: false,
    reason: 'The allowlisted host operations runner is not configured.',
  },
  {
    id: 'inventory.validate',
    label: 'Validate StationXML inventory',
    available: false,
    reason: 'The host inventory validation job is not configured.',
  },
  {
    id: 'inventory.apply',
    label: 'Apply validated StationXML inventory',
    available: false,
    reason: 'The approved, rollback-capable inventory job is not configured.',
  },
]);

function hasCompleteMetrics(data) {
  return ['cpu', 'memory', 'disk'].every((key) => (
    Number.isFinite(data?.[key]?.utilizationPercent)
    && ['healthy', 'warning', 'critical'].includes(data?.[key]?.status)
  ));
}

async function getSnapshot(req) {
  const telemetry = await AdminHostTelemetryClient.getResource('system', req);
  const metricsAvailable = telemetry.status !== 'unavailable' && hasCompleteMetrics(telemetry.data);
  const availability = metricsAvailable ? telemetry.status : 'unavailable';
  const reason = metricsAvailable
    ? null
    : telemetry.errorCode === 'not_configured'
      ? 'Deployment-host telemetry is not configured in this environment.'
      : 'Deployment-host telemetry is currently unavailable.';

  return {
    observedAt: telemetry.observedAt,
    operational: buildOperationalState({
      availability,
      observedAt: telemetry.observedAt,
      staleAfter: telemetry.operational?.freshness?.staleAfterMs,
      message: metricsAvailable
        ? 'Deployment-host resource metrics were retrieved.'
        : reason,
    }),
    status: availability,
    scope: telemetry.data?.scope || 'deployment-vm',
    sourceLabel: telemetry.data?.sourceLabel || 'EarthquakeHub deployment VM',
    sampleWindowMs: telemetry.data?.sampleWindowMs ?? null,
    metrics: metricsAvailable ? {
      cpu: telemetry.data.cpu,
      memory: telemetry.data.memory,
      disk: telemetry.data.disk,
    } : null,
    capabilities: {
      hostMetrics: {
        available: metricsAvailable,
        mode: 'read-only',
        reason,
      },
      hostOperations: {
        available: false,
        mode: 'gated',
        reason: 'Host actions remain disabled until an allowlisted executor, authorization policy, audit lifecycle, verification, and rollback path are deployed.',
        operations: GATED_OPERATIONS.map((operation) => ({ ...operation })),
      },
    },
    telemetry: {
      status: telemetry.status,
      errorCode: telemetry.errorCode || null,
      message: telemetry.message,
    },
  };
}

module.exports = { getSnapshot, hasCompleteMetrics };
