jest.mock('../src/services/adminHostTelemetry.client', () => ({ getResource: jest.fn() }));

const AdminHostTelemetryClient = require('../src/services/adminHostTelemetry.client');
const AdminSystemService = require('../src/services/adminSystem.service');

describe('admin system service', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns bounded deployment-host metrics and keeps host operations gated', async () => {
    AdminHostTelemetryClient.getResource.mockResolvedValue({
      observedAt: '2026-07-23T00:00:00.000Z',
      status: 'available',
      data: {
        scope: 'deployment-vm',
        sourceLabel: 'EarthquakeHub deployment VM',
        sampleWindowMs: 150,
        cpu: { utilizationPercent: 28, status: 'healthy' },
        memory: { utilizationPercent: 42, status: 'healthy' },
        disk: { utilizationPercent: 35, status: 'healthy', scopeLabel: 'VM root filesystem' },
      },
      message: 'Read-only check completed.',
    });

    const snapshot = await AdminSystemService.getSnapshot({ username: 'admin' });

    expect(snapshot.metrics.cpu.utilizationPercent).toBe(28);
    expect(snapshot.metrics.disk.scopeLabel).toBe('VM root filesystem');
    expect(snapshot.capabilities.hostMetrics).toEqual(expect.objectContaining({ available: true, mode: 'read-only' }));
    expect(snapshot.capabilities.hostOperations.available).toBe(false);
    expect(snapshot.capabilities.hostOperations.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'seiscomp.reload', available: false }),
      expect.objectContaining({ id: 'inventory.apply', available: false }),
    ]));
  });

  it('returns an explicit unavailable state without placeholder percentages', async () => {
    AdminHostTelemetryClient.getResource.mockResolvedValue({
      observedAt: null,
      status: 'unavailable',
      data: null,
      errorCode: 'not_configured',
      message: 'Host telemetry is unavailable.',
    });

    const snapshot = await AdminSystemService.getSnapshot({ username: 'admin' });

    expect(snapshot.status).toBe('unavailable');
    expect(snapshot.metrics).toBeNull();
    expect(snapshot.capabilities.hostMetrics).toEqual(expect.objectContaining({
      available: false,
      reason: expect.stringContaining('not configured'),
    }));
  });
});
