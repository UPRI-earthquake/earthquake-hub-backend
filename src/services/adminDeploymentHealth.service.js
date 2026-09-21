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

function declaredService({ id, name, logCommand, purpose, managedBy = 'compose' }) {
  return {
    id,
    name,
    managedBy,
    source: managedBy === 'host' ? 'Host integration architecture' : 'Deployment compose declaration',
    status: 'declared',
    runtimeVisibility: 'not_observable',
    setupGuidance: managedBy === 'host'
      ? 'Configure the read-only runtime publisher for module process evidence. Use SeisComP Monitoring and Archive for source-specific observations.'
      : 'Container runtime state is not collected. A separately bounded, read-only host observer would be required; do not expose a Docker socket to the web application.',
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
      source: 'Responding hub API process',
      managedBy: 'compose',
      status: 'observed',
      runtimeVisibility: 'observed',
      setupGuidance: 'This observation covers the responding Node.js process, not container health, restarts or its image.',
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
      observation: 'Declared HTTPS routing boundary. The separate fixed hub API probe does not establish nginx process or container state.',
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
      managedBy: 'host',
      logCommand: null,
    }),
    declaredService({ id: 'admin-backend', name: 'admin-backend', purpose: 'Private authenticated telemetry adapter (admin profile)', logCommand: 'docker compose logs --tail 200 admin-backend' }),
    declaredService({ id: 'geoserve-ws', name: 'geoserve-ws', purpose: 'Reverse geocoding service', logCommand: 'docker compose logs --tail 200 geoserve-ws' }),
    declaredService({ id: 'geoserve-db', name: 'geoserve-db', purpose: 'Reverse geocoding database', logCommand: 'docker compose logs --tail 200 geoserve-db' }),
    declaredService({ id: 'fdsnws', name: 'FDSNWS (host)', purpose: 'Station metadata, events and waveform access', managedBy: 'host', logCommand: null }),
    declaredService({ id: 'archive-writer', name: 'Archive writer (host)', purpose: 'Host-managed waveform archive writing', managedBy: 'host', logCommand: null }),
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
      declaredServices: services.filter((service) => service.status === 'declared').length,
      unobservedServices: services.filter((service) => service.status !== 'observed').length,
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
    topology: {
      source: 'Checked-in Compose and service topology; relationships are declared, not live traffic observations',
      edges: [
        { from: 'nginx-proxy', to: 'ehub-frontend', label: 'Public web routing' },
        { from: 'nginx-proxy', to: 'admin-frontend', label: 'Restricted admin routing' },
        { from: 'nginx-proxy', to: 'ehub-backend', label: 'API routing' },
        { from: 'nginx-proxy', to: 'ringserver', label: 'Ringserver proxy' },
        { from: 'nginx-proxy', to: 'fdsnws', label: 'FDSNWS proxy' },
        { from: 'ehub-backend', to: 'mongodb', label: 'Operational data' },
        { from: 'ehub-backend', to: 'geoserve-ws', label: 'Reverse geocoding' },
        { from: 'geoserve-ws', to: 'geoserve-db', label: 'Geocoding data' },
        { from: 'ehub-backend', to: 'admin-backend', label: 'Private authenticated telemetry' },
        { from: 'ringserver', to: 'ehub-backend', label: 'JWT verification' },
        { from: 'ringserver', to: 'seiscomp', label: 'SeedLink data path' },
      ],
    },
  };
}

module.exports = { getSnapshot };
