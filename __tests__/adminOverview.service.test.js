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
    AdminDevicesStationsService.listDevices.mockResolvedValue({ total: 8 });
    AdminAccountsService.listAccounts.mockResolvedValue({ total: 3 });
    CommentsService.getAdminModerationQueue.mockResolvedValue({ total: 2 });
    EQEventsService.getAdminEventQueue.mockResolvedValue({ total: 4, events: [{ publicID: 'event-1', OT: '2026-07-13T00:00:00.000Z', magnitude_value: 4.2, text: 'Test location' }] });
    AdminSeiscompService.getSnapshot.mockResolvedValue({ summary: { activeStations: 6, inactiveStations: 2, deliveredEvents: 4 } });
    AdminArchiveStorageService.getSnapshot.mockResolvedValue({ summary: { partialEvents: 1, unavailableEvents: 0, pendingEvents: 2 } });
    AdminDeploymentHealthService.getSnapshot.mockReturnValue({ summary: { observedServices: 1, unobservedServices: 7 } });
    AdminConfigurationDiagnosticsService.getSnapshot.mockReturnValue({ sensitiveSettings: [], validation: [] });
    AuditLogService.list.mockResolvedValue({ logs: [{ _id: 'audit-1', eventType: 'admin.test', outcome: 'succeeded', actor: { username: 'admin' }, target: { label: 'test' }, createdAt: '2026-07-13T00:00:00.000Z' }] });
  });

  it('keeps other source evidence when Ringserver is unavailable', async () => {
    AdminRingserverService.getSnapshot.mockRejectedValue(new Error('Ringserver unavailable'));

    const snapshot = await getSnapshot();

    expect(snapshot.summary.totalStations).toBe(8);
    expect(snapshot.summary.pendingReports).toBe(2);
    expect(snapshot.summary.archiveAttention).toBe(3);
    expect(snapshot.summary.availableSources).toBe(9);
    expect(snapshot.summary.unavailableSources).toBe(1);
    expect(snapshot.sources.find((source) => source.id === 'ringserver')).toMatchObject({ status: 'unavailable', message: 'Ringserver unavailable' });
    expect(snapshot.recentEvents[0]).toMatchObject({ publicID: 'event-1', magnitude: 4.2 });
    expect(snapshot.recentAudit[0]).toMatchObject({ eventType: 'admin.test', outcome: 'succeeded' });
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
