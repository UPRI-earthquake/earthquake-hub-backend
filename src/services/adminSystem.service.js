const AdminHostTelemetryClient = require('./adminHostTelemetry.client');
const {
  RUNBOOKS,
  UNAVAILABILITY_KINDS,
  buildUnavailability,
} = require('./adminCapabilities.service');
const { buildOperationalState } = require('./adminOperationalState.service');

const HOST_OPERATIONS_UNAVAILABILITY = buildUnavailability({
  kind: UNAVAILABILITY_KINDS.IMPLEMENTATION_REQUIRED,
  title: 'Host integration required',
  summary: 'Host actions remain disabled until a reviewed, allowlisted executor and complete safety lifecycle are deployed.',
  prerequisites: [
    'Deploy a separate least-privilege host operations identity and fixed operation allowlist.',
    'Add authorization, audit lifecycle, bounded output, verification, and rollback behavior.',
    'Validate each operation against direct host evidence before enabling browser controls.',
  ],
  runbook: RUNBOOKS.ACTION_CAPABILITIES,
});

const GATED_OPERATIONS = Object.freeze([
  {
    id: 'seiscomp.reload',
    label: 'Reload SeisComP configuration',
    available: false,
    reason: 'The allowlisted host operations runner is not configured.',
    unavailability: HOST_OPERATIONS_UNAVAILABILITY,
  },
  {
    id: 'seiscomp.restart',
    label: 'Restart SeisComP processing',
    available: false,
    reason: 'The allowlisted host operations runner is not configured.',
    unavailability: HOST_OPERATIONS_UNAVAILABILITY,
  },
  {
    id: 'inventory.validate',
    label: 'Validate StationXML inventory',
    available: false,
    reason: 'The host inventory validation job is not configured.',
    unavailability: HOST_OPERATIONS_UNAVAILABILITY,
  },
  {
    id: 'inventory.apply',
    label: 'Apply validated StationXML inventory',
    available: false,
    reason: 'The approved, rollback-capable inventory job is not configured.',
    unavailability: HOST_OPERATIONS_UNAVAILABILITY,
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
  const hostMetricsUnavailability = !metricsAvailable && telemetry.errorCode === 'not_configured'
    ? buildUnavailability({
      kind: UNAVAILABILITY_KINDS.HOST_SETUP_REQUIRED,
      title: 'Deployment-host telemetry setup required',
      summary: reason,
      prerequisites: [
        'Run the idempotent Admin Console host bootstrap on the target server.',
        'Restore the protected telemetry configuration and mTLS material.',
        'Verify the private telemetry adapter before refreshing this workspace.',
      ],
      runbook: RUNBOOKS.HOST_BOOTSTRAP,
    }) : null;

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
        ...(hostMetricsUnavailability ? { unavailability: hostMetricsUnavailability } : {}),
      },
      hostOperations: {
        available: false,
        mode: 'gated',
        reason: 'Host actions remain disabled until an allowlisted executor, authorization policy, audit lifecycle, verification, and rollback path are deployed.',
        unavailability: HOST_OPERATIONS_UNAVAILABILITY,
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
