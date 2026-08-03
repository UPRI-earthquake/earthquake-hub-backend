const AdminHostTelemetryClient = require('./adminHostTelemetry.client');
const AdminSystemService = require('./adminSystem.service');
const { buildOperationalState } = require('./adminOperationalState.service');

function durationLabel(seconds) {
  const totalMinutes = Math.max(0, Math.floor(seconds / 60));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days) return String(days) + 'd ' + String(hours) + 'h';
  if (hours) return String(hours) + 'h ' + String(minutes) + 'm';
  return String(minutes) + 'm';
}

function declaredService({ id, name, logCommand, purpose }) {
  return {
    id,
    name,
    source: 'Deployment compose declaration',
    status: 'unobserved',
    observation: 'The backend has no Docker-socket or host service access, so this declared service cannot be live-checked here.',
    observedAt: null,
    purpose,
    logCommand,
  };
}

async function getSnapshot(req) {
  const observedAt = new Date().toISOString();
  const backendUptime = process.uptime();
  const [hostTelemetry, systemResources] = await Promise.all([
    AdminHostTelemetryClient.getResource('deployment', req),
    AdminSystemService.getSnapshot(req),
  ]);
  const deploymentObserved = hostTelemetry.status === 'available';
  const operationalAvailability = hostTelemetry.status === 'available'
    && hostTelemetry.operational?.state === 'healthy'
    && systemResources.status === 'available'
    && systemResources.operational?.state === 'healthy'
    ? 'available'
    : 'degraded';
  const services = [
    {
      id: 'ehub-backend',
      name: 'ehub-backend',
      source: 'Admin backend runtime',
      status: 'observed',
      observation: 'This Node.js backend process is responding. Process uptime: ' + durationLabel(backendUptime) + '.',
      observedAt,
      purpose: 'EarthquakeHub API and admin routes',
      logCommand: 'docker compose logs --tail 200 ehub-backend',
    },
    {
      ...declaredService({
        id: 'nginx-proxy',
        name: 'nginx-proxy',
        purpose: 'HTTPS reverse proxy and internal admin route boundary',
        logCommand: 'docker compose logs --tail 200 nginx-proxy',
      }),
      source: 'Private admin-backend telemetry',
      status: deploymentObserved ? 'observed' : 'unobserved',
      observation: deploymentObserved
        ? `The fixed hub API reachability check completed with HTTP ${hostTelemetry.data?.httpStatus ?? 'unknown'} in ${hostTelemetry.data?.latencyMs ?? 'unknown'} ms.`
        : 'The fixed hub API reachability check is unavailable; no Docker state was inferred.',
      observedAt: hostTelemetry.observedAt,
    },
    declaredService({
      id: 'ehub-frontend',
      name: 'ehub-frontend',
      purpose: 'Public EarthquakeHub web interface',
      logCommand: 'docker compose logs --tail 200 ehub-frontend',
    }),
    declaredService({
      id: 'admin-frontend',
      name: 'admin-frontend',
      purpose: 'Restricted EarthquakeHub Admin Console',
      logCommand: 'docker compose logs --tail 200 admin-frontend',
    }),
    declaredService({
      id: 'ringserver',
      name: 'ringserver',
      purpose: 'DataLink and SeedLink waveform transport',
      logCommand: 'docker compose logs --tail 200 ringserver',
    }),
    declaredService({
      id: 'wstunnel-server',
      name: 'wstunnel-server',
      purpose: 'WSTunnel relay for remote station access',
      logCommand: 'docker compose logs --tail 200 wstunnel-server',
    }),
    declaredService({
      id: 'mongodb',
      name: 'mongodb',
      purpose: 'EarthquakeHub operational data store',
      logCommand: 'docker compose logs --tail 200 mongodb',
    }),
    declaredService({
      id: 'seiscomp',
      name: 'SeisComP (host)',
      purpose: 'Host-level seismic processing and event pipeline',
      logCommand: 'journalctl -u seiscomp --since "1 hour ago" --no-pager',
    }),
  ];

  return {
    observedAt,
    operational: buildOperationalState({
      availability: operationalAvailability,
      observedAt,
      message: operationalAvailability === 'available'
        ? 'Runtime and deployment-host evidence were retrieved.'
        : 'The backend is responding, but some deployment-host evidence is unavailable or degraded.',
    }),
    summary: {
      observedServices: services.filter((service) => service.status === 'observed').length,
      declaredServices: services.length - 1,
      unobservedServices: services.filter((service) => service.status === 'unobserved').length,
      backendUptimeSeconds: Math.floor(backendUptime),
      hostTelemetryStatus: hostTelemetry.status,
      hostTelemetryFreshness: hostTelemetry.operational?.freshness?.status || 'unknown',
      systemTelemetryStatus: systemResources.status,
      systemTelemetryFreshness: systemResources.operational?.freshness?.status || 'unknown',
    },
    limitations: [
      'The private admin backend performs one fixed HTTP reachability check. Container health states and Docker logs remain unavailable; neither backend has Docker-socket access.',
      'SeisComP is a host-level service, outside the EarthquakeHub Docker compose stack.',
      'Use the supplied read-only commands from an authorized deployment-host shell. Commands are not run by this console.',
    ],
    hostTelemetry,
    systemResources,
    capabilities: systemResources.capabilities,
    services,
  };
}

module.exports = { getSnapshot };
