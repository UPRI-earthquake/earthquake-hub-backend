const AdminAccountsService = require('./adminAccounts.service');
const AdminArchiveStorageService = require('./adminArchiveStorage.service');
const AdminConfigurationDiagnosticsService = require('./adminConfigurationDiagnostics.service');
const AdminDevicesStationsService = require('./adminDevicesStations.service');
const AdminDeploymentHealthService = require('./adminDeploymentHealth.service');
const AdminIncidentService = require('./adminIncident.service');
const AdminRingserverService = require('./adminRingserver.service');
const AdminSeiscompService = require('./adminSeiscomp.service');
const { buildOperationalState, freshness } = require('./adminOperationalState.service');
const AuditLogService = require('./auditLog.service');
const CommentsService = require('./comments.service');
const EQEventsService = require('./EQevents.service');

const DEFAULT_CACHE_TTL_MS = 5000;
const DEFAULT_SOURCE_TIMEOUT_MS = 2500;
const STATION_SNAPSHOT_LIMIT = 13;
const MIN_MEANINGFUL_ACTIVITY_TIME = Date.UTC(2000, 0, 1);

let cachedSnapshot = null;
let cacheExpiresAt = 0;
let inFlightSnapshot = null;
const sourceHealth = new Map();

function positiveIntegerEnv(name, fallback) {
  const value = Number.parseInt(process.env[name], 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function withTimeout(load, timeoutMs, sourceId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error(`${sourceId} snapshot timed out after ${timeoutMs}ms.`);
      error.code = 'ADMIN_OVERVIEW_SOURCE_TIMEOUT';
      reject(error);
    }, timeoutMs);
    Promise.resolve().then(load).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

function sourceState(id, label, route, result, project, observedAt) {
  const prior = sourceHealth.get(id) || {};
  if (result.status === 'rejected') {
    const failureSince = prior.failureSince || observedAt;
    const health = { ...prior, failureSince, lastError: result.reason?.message || 'Subsystem snapshot could not be retrieved.' };
    sourceHealth.set(id, health);
    return {
      id,
      label,
      route,
      status: 'unavailable',
      message: health.lastError,
      metrics: null,
      lastSuccessfulAt: prior.lastSuccessfulAt || null,
      failureSince,
      failureDurationMs: Math.max(0, new Date(observedAt).getTime() - new Date(failureSince).getTime()),
      freshness: freshness({ observedAt: null }),
    };
  }

  const snapshot = result.value;
  const sourceObservedAt = snapshot?.operational?.freshness?.observedAt
    || snapshot?.observedAt
    || observedAt;
  const sourceFreshness = snapshot?.operational?.freshness
    || freshness({ observedAt: sourceObservedAt, now: observedAt });
  const availability = snapshot?.operational?.availability || 'available';
  const status = availability === 'unavailable'
    ? 'unavailable'
    : availability === 'degraded'
      ? 'degraded'
      : sourceFreshness.status === 'stale'
        ? 'stale'
        : 'available';
  const message = snapshot?.operational?.message
    || (status === 'available' ? 'Live snapshot retrieved.' : 'Snapshot returned with limited operational evidence.');

  if (status === 'unavailable') {
    const failureSince = prior.failureSince || observedAt;
    sourceHealth.set(id, {
      ...prior,
      failureSince,
      lastError: message,
    });
    return {
      id,
      label,
      route,
      status,
      message,
      metrics: project(snapshot),
      observedAt: sourceObservedAt,
      freshness: sourceFreshness,
      lastSuccessfulAt: prior.lastSuccessfulAt || null,
      failureSince,
      failureDurationMs: Math.max(0, new Date(observedAt).getTime() - new Date(failureSince).getTime()),
    };
  }

  sourceHealth.set(id, { lastSuccessfulAt: sourceObservedAt, failureSince: null, lastError: null });
  return {
    id,
    label,
    route,
    status,
    message,
    metrics: project(snapshot),
    observedAt: sourceObservedAt,
    freshness: sourceFreshness,
    lastSuccessfulAt: sourceObservedAt,
    failureSince: null,
    failureDurationMs: null,
  };
}

function sourceValue(sources, id) {
  return sources.find((source) => source.id === id)?.metrics || null;
}

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function stationActivityPriority(activity) {
  switch (String(activity || '').toLowerCase()) {
    case 'internal_error': return 0;
    case 'inactive': return 1;
    case 'unlinked': return 2;
    case 'active':
    case 'streaming': return 4;
    default: return 3;
  }
}

function meaningfulActivityTime(value) {
  const time = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(time) && time >= MIN_MEANINGFUL_ACTIVITY_TIME ? time : null;
}

function stationMetrics(value) {
  const devices = Array.isArray(value?.devices) ? value.devices : [];
  const isActive = (device) => ['active', 'streaming'].includes(String(device.activity || '').toLowerCase());
  const active = devices.filter(isActive).length;
  const unlinked = devices.filter((device) => String(device.activity || '').toLowerCase() === 'unlinked'
    || !device.streamId
    || device.streamId === 'TO_BE_LINKED').length;
  const stationRows = devices.map((device) => ({
    deviceId: device.deviceId,
    network: device.network || null,
    streamId: device.streamId && device.streamId !== 'TO_BE_LINKED' ? device.streamId : null,
    activity: device.activity || 'unknown',
    activityToggleTime: meaningfulActivityTime(device.activityToggleTime) === null
      ? null
      : new Date(device.activityToggleTime).toISOString(),
    hasTunnel: Boolean(device.tunnel),
  }));
  const rankedRows = [...stationRows].sort((left, right) => {
    const priorityDifference = stationActivityPriority(left.activity) - stationActivityPriority(right.activity);
    if (priorityDifference) return priorityDifference;

    const leftTime = meaningfulActivityTime(left.activityToggleTime);
    const rightTime = meaningfulActivityTime(right.activityToggleTime);
    if (leftTime !== null && rightTime !== null && leftTime !== rightTime) return leftTime - rightTime;
    if (leftTime !== null) return -1;
    if (rightTime !== null) return 1;
    return String(left.deviceId || '').localeCompare(String(right.deviceId || ''));
  });
  const activeRows = rankedRows.filter(isActive);
  const attentionRows = rankedRows.filter((device) => !isActive(device));
  const snapshot = [
    ...attentionRows,
    ...activeRows,
  ].slice(0, STATION_SNAPSHOT_LIMIT);
  return {
    total: numberOrNull(value?.total),
    active,
    inactive: Math.max(0, devices.length - active),
    unlinked,
    tunneled: devices.filter((device) => Boolean(device.tunnel)).length,
    snapshot,
  };
}

function deploymentMetrics(value) {
  return {
    observedServices: numberOrNull(value.summary?.observedServices),
    unobservedServices: numberOrNull(value.summary?.unobservedServices),
    services: (value.services || []).slice(0, 8).map((service) => ({
      id: service.id,
      name: service.name,
      status: service.status,
      observation: service.observation,
      observedAt: service.observedAt || null,
      purpose: service.purpose,
    })),
  };
}

function definitions(req) {
  return [
    {
      id: 'stations',
      label: 'Devices & Stations',
      route: '/devices-stations',
      // listDevices already materializes the inventory before applying its
      // pagination slice. Request the complete internal result for accurate
      // totals, then expose a bounded, non-sensitive operational sample.
      load: () => AdminDevicesStationsService.listDevices({ limit: Number.MAX_SAFE_INTEGER, offset: 0 }),
      project: stationMetrics,
    },
    {
      id: 'accounts',
      label: 'Accounts',
      route: '/accounts',
      load: () => AdminAccountsService.listAccounts({ limit: 1, offset: 0 }),
      project: (value) => ({ total: value.total }),
    },
    {
      id: 'moderation',
      label: 'Community Reports',
      route: '/community-reports',
      load: () => CommentsService.getAdminModerationQueue({ status: 'pending', limit: 1, offset: 0 }),
      project: (value) => ({ pending: value.total }),
    },
    {
      id: 'events',
      label: 'Earthquake Events',
      route: '/earthquake-events',
      load: () => EQEventsService.getAdminEventQueue({ limit: 5, offset: 0 }),
      project: (value) => ({
        total: value.total,
        recent: (value.events || []).map((event) => ({
          id: event.publicID,
          publicID: event.publicID,
          magnitude: event.magnitude_value ?? null,
          location: event.text || null,
          originTime: event.OT ? new Date(event.OT).toISOString() : null,
          enrichmentStatus: event.enrichmentStatus || null,
        })),
      }),
    },
    {
      id: 'ringserver',
      label: 'Ringserver',
      route: '/ringserver',
      load: () => AdminRingserverService.getSnapshot({ connectionLimit: 1, streamLimit: 1 }),
      project: (value) => ({
        activeConnections: numberOrNull(value.summary?.activeConnections),
        activeStreams: numberOrNull(value.summary?.activeStreams),
        dataLinkWriters: numberOrNull(value.summary?.dataLinkWriters),
        seedLinkReaders: numberOrNull(value.summary?.seedLinkReaders),
      }),
    },
    {
      id: 'seiscomp', label: 'SeisComP', route: '/seiscomp', load: () => AdminSeiscompService.getSnapshot({ limit: 1 }, req),
      project: (value) => ({ activeStations: numberOrNull(value.summary?.activeStations), inactiveStations: numberOrNull(value.summary?.inactiveStations), deliveredEvents: numberOrNull(value.summary?.deliveredEvents) }),
    },
    {
      id: 'archive', label: 'Archive & Storage', route: '/archive-storage', load: () => AdminArchiveStorageService.getSnapshot({ windowHours: 24, limit: 1 }, req),
      project: (value) => ({
        verifiedEvents: numberOrNull(value.summary?.verifiedEvents),
        partialEvents: numberOrNull(value.summary?.partialEvents),
        unavailableEvents: numberOrNull(value.summary?.unavailableEvents),
        pendingEvents: numberOrNull(value.summary?.pendingEvents),
        archiveMounted: value.summary?.archiveMounted ?? null,
        archiveFreeSpaceBand: value.summary?.archiveFreeSpaceBand || null,
        latestFdsnVerificationAt: value.summary?.latestFdsnVerificationAt || null,
        latestFdsnVerificationStatus: value.summary?.latestFdsnVerificationStatus || null,
      }),
    },
    {
      id: 'deployment', label: 'Deployment', route: '/deployment', load: () => AdminDeploymentHealthService.getSnapshot(req),
      project: deploymentMetrics,
    },
    {
      id: 'configuration', label: 'Settings', route: '/settings', load: () => Promise.resolve(AdminConfigurationDiagnosticsService.getSnapshot()),
      project: (value) => ({ missingRequired: (value.sensitiveSettings || []).filter((setting) => setting.required && setting.status === 'missing').length, validationWarnings: (value.validation || []).filter((check) => check.status === 'warning' || check.status === 'invalid').length }),
    },
    {
      id: 'audit', label: 'Audit Logs', route: '/audit-logs', load: () => AuditLogService.list({}, { limit: 8, offset: 0 }),
      project: (value) => ({ recent: (value.logs || []).map((log) => ({ id: String(log._id), eventType: log.eventType, outcome: log.outcome, actor: log.actor?.username || 'system', target: log.target?.label || log.target?.id || '—', createdAt: log.createdAt ? new Date(log.createdAt).toISOString() : null })) }),
    },
  ];
}

async function buildSnapshot(req) {
  const observedAt = new Date().toISOString();
  const sourceTimeoutMs = positiveIntegerEnv('ADMIN_OVERVIEW_SOURCE_TIMEOUT_MS', DEFAULT_SOURCE_TIMEOUT_MS);
  const sourceDefinitions = definitions(req);
  const settled = await Promise.allSettled(sourceDefinitions.map((definition) => withTimeout(definition.load, sourceTimeoutMs, definition.id)));
  const sources = sourceDefinitions.map((definition, index) => sourceState(definition.id, definition.label, definition.route, settled[index], definition.project, observedAt));
  const stationMetrics = sourceValue(sources, 'stations');
  const moderationMetrics = sourceValue(sources, 'moderation');
  const eventMetrics = sourceValue(sources, 'events');
  const seiscompMetrics = sourceValue(sources, 'seiscomp');
  const archiveMetrics = sourceValue(sources, 'archive');
  const deploymentMetrics = sourceValue(sources, 'deployment');
  const configurationMetrics = sourceValue(sources, 'configuration');
  const auditMetrics = sourceValue(sources, 'audit');
  const unavailableSources = sources.filter((source) => source.status === 'unavailable').length;
  const degradedSources = sources.filter((source) => source.status === 'degraded').length;
  const staleSources = sources.filter((source) => source.status === 'stale').length;
  const operationalAvailability = unavailableSources === sources.length
    ? 'unavailable'
    : unavailableSources || degradedSources || staleSources
      ? 'degraded'
      : 'available';

  const snapshot = {
    observedAt,
    operational: buildOperationalState({
      availability: operationalAvailability,
      observedAt,
      message: operationalAvailability === 'available'
        ? 'All overview sources returned current operational evidence.'
        : `${unavailableSources} unavailable, ${degradedSources} degraded, and ${staleSources} stale overview sources.`,
    }),
    cache: { ttlMs: positiveIntegerEnv('ADMIN_OVERVIEW_CACHE_TTL_MS', DEFAULT_CACHE_TTL_MS), cached: false },
    summary: {
      totalStations: stationMetrics?.total ?? null,
      activeStations: seiscompMetrics?.activeStations ?? null,
      pendingReports: moderationMetrics?.pending ?? null,
      recentEvents: eventMetrics?.total ?? null,
      archiveAttention: archiveMetrics ? (archiveMetrics.partialEvents || 0) + (archiveMetrics.unavailableEvents || 0) + (archiveMetrics.pendingEvents || 0) : null,
      deploymentAttention: deploymentMetrics?.unobservedServices ?? null,
      configurationAttention: configurationMetrics ? (configurationMetrics.missingRequired || 0) + (configurationMetrics.validationWarnings || 0) : null,
      availableSources: sources.filter((source) => source.status === 'available').length,
      degradedSources,
      staleSources,
      unavailableSources,
    },
    sources,
    recentEvents: eventMetrics?.recent || [],
    recentAudit: auditMetrics?.recent || [],
  };
  try {
    const incidentState = await AdminIncidentService.synchronizeOverview(snapshot);
    return {
      ...snapshot,
      incidents: incidentState.incidents,
      incidentSummary: incidentState.summary,
      incidentOperational: {
        availability: 'available',
        message: 'Persistent operational incidents synchronized.',
      },
    };
  } catch (error) {
    console.error('Unable to synchronize operational incidents:', error?.message || error);
    return {
      ...snapshot,
      incidents: [],
      incidentSummary: null,
      incidentOperational: {
        availability: 'unavailable',
        message: 'Operational incident persistence is currently unavailable.',
      },
    };
  }
}

async function getSnapshot(req) {
  const now = Date.now();
  if (cachedSnapshot && now < cacheExpiresAt) return { ...cachedSnapshot, cache: { ...cachedSnapshot.cache, cached: true } };
  if (inFlightSnapshot) return inFlightSnapshot;
  const cacheTtlMs = positiveIntegerEnv('ADMIN_OVERVIEW_CACHE_TTL_MS', DEFAULT_CACHE_TTL_MS);
  inFlightSnapshot = buildSnapshot(req)
    .then((snapshot) => {
      cachedSnapshot = snapshot;
      cacheExpiresAt = Date.now() + cacheTtlMs;
      return snapshot;
    })
    .finally(() => { inFlightSnapshot = null; });
  return inFlightSnapshot;
}

function resetOverviewState() {
  cachedSnapshot = null;
  cacheExpiresAt = 0;
  inFlightSnapshot = null;
  sourceHealth.clear();
}

module.exports = { getSnapshot, resetOverviewState };
