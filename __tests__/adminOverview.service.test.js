jest.mock('../src/services/adminAccounts.service', () => ({ listAccounts: jest.fn() }));
jest.mock('../src/services/adminArchiveStorage.service', () => ({ getSnapshot: jest.fn() }));
jest.mock('../src/services/adminConfigurationDiagnostics.service', () => ({ getSnapshot: jest.fn() }));
jest.mock('../src/services/adminDevicesStations.service', () => ({ listDevices: jest.fn() }));
jest.mock('../src/services/adminDeploymentHealth.service', () => ({ getSnapshot: jest.fn() }));
jest.mock('../src/services/adminRingserver.service', () => ({ getSnapshot: jest.fn() }));
jest.mock('../src/services/adminSeiscomp.service', () => ({ getSnapshot: jest.fn() }));
jest.mock('../src/services/auditLog.service', () => ({ list: jest.fn() }));
jest.mock('../src/services/comments.service', () => ({ getAdminModerationQueue: jest.fn() }));
jest.mock('../src/services/EQevents.service', () => ({ getAdminEventQueue: jest.fn() }));

const AdminAccountsService = require('../src/services/adminAccounts.service');
const AdminArchiveStorageService = require('../src/services/adminArchiveStorage.service');
const AdminConfigurationDiagnosticsService = require('../src/services/adminConfigurationDiagnostics.service');
const AdminDevicesStationsService = require('../src/services/adminDevicesStations.service');
const AdminDeploymentHealthService = require('../src/services/adminDeploymentHealth.service');
const AdminRingserverService = require('../src/services/adminRingserver.service');
const AdminSeiscompService = require('../src/services/adminSeiscomp.service');
const AuditLogService = require('../src/services/auditLog.service');
const CommentsService = require('../src/services/comments.service');
const EQEventsService = require('../src/services/EQevents.service');
const { getSnapshot, resetOverviewState } = require('../src/services/adminOverview.service');

describe('admin overview aggregation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetOverviewState();
    delete process.env.ADMIN_OVERVIEW_CACHE_TTL_MS;
    delete process.env.ADMIN_OVERVIEW_SOURCE_TIMEOUT_MS;
    AdminDevicesStationsService.listDevices.mockResolvedValue({
      total: 3,
      devices: [
        { deviceId: 'AM_ACTIVE', network: 'AM', streamId: 'AM_ACTIVE.*', activity: 'active', activityToggleTime: '2026-07-13T00:00:00.000Z', tunnel: { remotePort: 20001 }, macAddress: '00:00:00:00:00:01' },
        { deviceId: 'AM_OFFLINE', network: 'AM', streamId: 'AM_OFFLINE.*', activity: 'inactive', activityToggleTime: '2026-07-13T01:00:00.000Z', tunnel: null, macAddress: '00:00:00:00:00:02' },
        { deviceId: 'AM_UNLINKED', network: 'AM', streamId: 'TO_BE_LINKED', activity: 'unlinked', activityToggleTime: '2026-07-13T02:00:00.000Z', tunnel: null, macAddress: '00:00:00:00:00:03' },
      ],
    });
    AdminAccountsService.listAccounts.mockResolvedValue({ total: 3 });
    CommentsService.getAdminModerationQueue.mockResolvedValue({ total: 2 });
    EQEventsService.getAdminEventQueue.mockResolvedValue({ total: 4, events: [{ publicID: 'event-1', OT: '2026-07-13T00:00:00.000Z', magnitude_value: 4.2, text: 'Test location' }] });
    AdminSeiscompService.getSnapshot.mockResolvedValue({ summary: { activeStations: 6, inactiveStations: 2, deliveredEvents: 4 } });
    AdminArchiveStorageService.getSnapshot.mockResolvedValue({ summary: { verifiedEvents: 5, partialEvents: 1, unavailableEvents: 0, pendingEvents: 2, archiveMounted: true, archiveFreeSpaceBand: 'healthy', latestFdsnVerificationAt: '2026-07-13T00:00:00.000Z', latestFdsnVerificationStatus: 'verified' } });
    AdminDeploymentHealthService.getSnapshot.mockReturnValue({
      summary: { observedServices: 1, unobservedServices: 7 },
      services: [{ id: 'ehub-backend', name: 'ehub-backend', status: 'observed', observation: 'Backend responding.', observedAt: '2026-07-13T00:00:00.000Z', purpose: 'EarthquakeHub API', logCommand: 'sensitive operational command' }],
    });
    AdminConfigurationDiagnosticsService.getSnapshot.mockReturnValue({ sensitiveSettings: [], validation: [] });
    AuditLogService.list.mockResolvedValue({ logs: [{ _id: 'audit-1', eventType: 'admin.test', outcome: 'succeeded', actor: { username: 'admin' }, target: { label: 'test' }, createdAt: '2026-07-13T00:00:00.000Z' }] });
  });

  it('keeps other source evidence when Ringserver is unavailable', async () => {
    AdminRingserverService.getSnapshot.mockRejectedValue(new Error('Ringserver unavailable'));

    const snapshot = await getSnapshot();

    expect(snapshot.summary.totalStations).toBe(3);
    expect(snapshot.summary.pendingReports).toBe(2);
    expect(snapshot.summary.archiveAttention).toBe(3);
    expect(snapshot.summary.availableSources).toBe(9);
    expect(snapshot.summary.unavailableSources).toBe(1);
    expect(snapshot.sources.find((source) => source.id === 'ringserver')).toMatchObject({ status: 'unavailable', message: 'Ringserver unavailable' });
    expect(snapshot.recentEvents[0]).toMatchObject({ publicID: 'event-1', magnitude: 4.2 });
    expect(snapshot.recentAudit[0]).toMatchObject({ eventType: 'admin.test', outcome: 'succeeded' });
  });

  it('returns a bounded station sample and component evidence without sensitive device or command fields', async () => {
    AdminRingserverService.getSnapshot.mockResolvedValue({ summary: { activeConnections: 4, activeStreams: 8, dataLinkWriters: 2, seedLinkReaders: 2 } });

    const snapshot = await getSnapshot();
    const stations = snapshot.sources.find((source) => source.id === 'stations').metrics;
    const deployment = snapshot.sources.find((source) => source.id === 'deployment').metrics;
    const ringserver = snapshot.sources.find((source) => source.id === 'ringserver').metrics;
    const archive = snapshot.sources.find((source) => source.id === 'archive').metrics;

    expect(AdminDevicesStationsService.listDevices).toHaveBeenCalledWith({ limit: Number.MAX_SAFE_INTEGER, offset: 0 });
    expect(stations).toMatchObject({ total: 3, active: 1, inactive: 2, unlinked: 1, tunneled: 1 });
    expect(stations.snapshot[0]).toHaveProperty('network', 'AM');
    expect(stations.snapshot.map((station) => station.deviceId)).toEqual(['AM_OFFLINE', 'AM_UNLINKED', 'AM_ACTIVE']);
    expect(stations.snapshot[0]).not.toHaveProperty('macAddress');
    expect(deployment.services[0]).not.toHaveProperty('logCommand');
    expect(ringserver).toMatchObject({ activeConnections: 4, activeStreams: 8, dataLinkWriters: 2, seedLinkReaders: 2 });
    expect(archive).toMatchObject({ verifiedEvents: 5, archiveMounted: true, archiveFreeSpaceBand: 'healthy' });
  });

  it('fills the station sample with attention rows before using active fallback rows', async () => {
    const inactiveDevices = Array.from({ length: 10 }, (_, index) => ({
      deviceId: `AM_INACTIVE_${index}`,
      streamId: `AM_INACTIVE_${index}.*`,
      activity: 'inactive',
      activityToggleTime: '2026-07-13T01:00:00.000Z',
      tunnel: null,
    }));
    const activeDevices = Array.from({ length: 4 }, (_, index) => ({
      deviceId: `AM_ACTIVE_${index}`,
      streamId: `AM_ACTIVE_${index}.*`,
      activity: 'active',
      activityToggleTime: '2026-07-13T02:00:00.000Z',
      tunnel: { remotePort: 20000 + index },
    }));
    AdminDevicesStationsService.listDevices.mockResolvedValue({
      total: inactiveDevices.length + activeDevices.length,
      devices: [...inactiveDevices, ...activeDevices],
    });
    AdminRingserverService.getSnapshot.mockResolvedValue({ summary: {} });

    const snapshot = await getSnapshot();
    const stations = snapshot.sources.find((source) => source.id === 'stations').metrics.snapshot;

    expect(stations).toHaveLength(13);
    expect(stations.slice(0, 10).every((station) => station.activity === 'inactive')).toBe(true);
    expect(stations.slice(10).every((station) => station.activity === 'active')).toBe(true);
  });

  it('prioritizes station attention by activity severity and oldest meaningful state change', async () => {
    AdminDevicesStationsService.listDevices.mockResolvedValue({
      total: 6,
      devices: [
        { deviceId: 'AM_ACTIVE', streamId: 'AM_ACTIVE.*', activity: 'active', activityToggleTime: '2026-07-10T00:00:00.000Z', tunnel: {} },
        { deviceId: 'AM_UNLINKED', streamId: 'TO_BE_LINKED', activity: 'unlinked', activityToggleTime: '2026-07-09T00:00:00.000Z', tunnel: null },
        { deviceId: 'AM_INACTIVE_NEW', streamId: 'AM_INACTIVE_NEW.*', activity: 'inactive', activityToggleTime: '2026-07-14T00:00:00.000Z', tunnel: null },
        { deviceId: 'AM_INTERNAL', streamId: 'AM_INTERNAL.*', activity: 'internal_error', activityToggleTime: '2026-07-15T00:00:00.000Z', tunnel: null },
        { deviceId: 'AM_INACTIVE_UNKNOWN_TIME', streamId: 'AM_INACTIVE_UNKNOWN_TIME.*', activity: 'inactive', activityToggleTime: '1970-01-01T00:00:00.000Z', tunnel: null },
        { deviceId: 'AM_INACTIVE_OLD', streamId: 'AM_INACTIVE_OLD.*', activity: 'inactive', activityToggleTime: '2026-07-10T00:00:00.000Z', tunnel: null },
      ],
    });
    AdminRingserverService.getSnapshot.mockResolvedValue({ summary: {} });

    const snapshot = await getSnapshot();
    const stations = snapshot.sources.find((source) => source.id === 'stations').metrics.snapshot;

    expect(stations.map((station) => station.deviceId)).toEqual([
      'AM_INTERNAL',
      'AM_INACTIVE_OLD',
      'AM_INACTIVE_NEW',
      'AM_INACTIVE_UNKNOWN_TIME',
      'AM_UNLINKED',
      'AM_ACTIVE',
    ]);
    expect(stations.find((station) => station.deviceId === 'AM_INACTIVE_UNKNOWN_TIME').activityToggleTime).toBeNull();
  });

  it('times out a slow Ringserver snapshot without blocking the remaining sources', async () => {
    process.env.ADMIN_OVERVIEW_SOURCE_TIMEOUT_MS = '5';
    AdminRingserverService.getSnapshot.mockImplementation(() => new Promise(() => {}));

    const snapshot = await getSnapshot();
    const ringserver = snapshot.sources.find((source) => source.id === 'ringserver');

    expect(ringserver).toMatchObject({ status: 'unavailable', failureSince: snapshot.observedAt });
    expect(ringserver.message).toMatch(/timed out/i);
    expect(snapshot.summary.availableSources).toBe(9);
  });

  it('reuses the short-lived aggregate snapshot instead of reloading every subsystem', async () => {
    process.env.ADMIN_OVERVIEW_CACHE_TTL_MS = '5000';

    const first = await getSnapshot();
    const second = await getSnapshot();

    expect(second.cache.cached).toBe(true);
    expect(second.observedAt).toBe(first.observedAt);
    expect(AdminRingserverService.getSnapshot).toHaveBeenCalledTimes(1);
    expect(AdminDevicesStationsService.listDevices).toHaveBeenCalledTimes(1);
  });

  it('keeps the last successful Ringserver retrieval while a later request fails', async () => {
    process.env.ADMIN_OVERVIEW_CACHE_TTL_MS = '1';
    AdminRingserverService.getSnapshot.mockResolvedValue({ summary: { activeConnections: 2, activeStreams: 3 } });
    const first = await getSnapshot();
    const lastSuccessfulAt = first.sources.find((source) => source.id === 'ringserver').lastSuccessfulAt;

    await new Promise((resolve) => setTimeout(resolve, 5));
    AdminRingserverService.getSnapshot.mockRejectedValue(new Error('Ringserver unavailable'));
    const second = await getSnapshot();
    const ringserver = second.sources.find((source) => source.id === 'ringserver');

    expect(ringserver).toMatchObject({ status: 'unavailable', lastSuccessfulAt, failureSince: second.observedAt });
    expect(ringserver.failureDurationMs).toBeGreaterThanOrEqual(0);
  });
});
