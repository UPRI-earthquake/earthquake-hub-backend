jest.mock('../src/models/device.model', () => ({ find: jest.fn() }));
jest.mock('../src/services/tunnelEnrollment.service', () => ({ listActiveMappings: jest.fn() }));
jest.mock('../src/services/adminHostTelemetry.client', () => ({ getResource: jest.fn() }));

const Device = require('../src/models/device.model');
const TunnelEnrollmentService = require('../src/services/tunnelEnrollment.service');
const AdminHostTelemetryClient = require('../src/services/adminHostTelemetry.client');
const AdminDevicesStationsService = require('../src/services/adminDevicesStations.service');

function findChain(devices) {
  return {
    sort: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(devices),
  };
}

describe('Admin devices and stations service', () => {
  beforeEach(() => jest.clearAllMocks());

  it('uses the combined attention activities for the evidence-card filter', async () => {
    Device.find.mockReturnValue(findChain([]));
    TunnelEnrollmentService.listActiveMappings.mockResolvedValue([]);

    await AdminDevicesStationsService.listDevices({ attention: true });

    expect(Device.find).toHaveBeenCalledWith({ activity: { $in: ['inactive', 'internal_error', 'INTERNAL_ERROR'] } });
  });

  it('uses active and streaming activities for the operational filter', async () => {
    Device.find.mockReturnValue(findChain([]));
    TunnelEnrollmentService.listActiveMappings.mockResolvedValue([]);

    await AdminDevicesStationsService.listDevices({ isActive: true });

    expect(Device.find).toHaveBeenCalledWith({ activity: { $in: ['active', 'streaming'] } });
  });

  it('summarizes actual activity, linkage, tunnels, and network facets', () => {
    const devices = [
      { network: 'AM', station: 'R1382', streamId: 'AM_R1382_00_EHZ/MSEED', activity: 'active' },
      { network: 'AM', station: 'R2045', streamId: 'TO_BE_LINKED', activity: 'unlinked' },
      { network: 'PH', station: 'BGLB', streamId: 'PH_BGLB_00_BHZ/MSEED', activity: 'inactive' },
      { network: 'XX', station: 'TEST1', streamId: 'XX_TEST1_00_EHZ/MSEED', activity: 'INTERNAL_ERROR' },
    ];
    const mappings = new Map([['AM_R1382', { deviceId: 'AM_R1382' }]]);

    expect(AdminDevicesStationsService.summarizeDevices(devices, mappings)).toEqual({
      total: 4, active: 1, attention: 2, unlinked: 1, tunneled: 1, networks: ['AM', 'PH', 'XX'],
    });
  });

  it('returns unfiltered summary evidence alongside a filtered page', async () => {
    const filtered = [{ network: 'AM', station: 'R1382', streamId: 'AM_R1382_00_EHZ/MSEED', activity: 'active' }];
    const all = [...filtered, { network: 'PH', station: 'BGLB', streamId: 'TO_BE_LINKED', activity: 'unlinked' }];
    Device.find.mockReturnValueOnce(findChain(filtered)).mockReturnValueOnce(findChain(all));
    TunnelEnrollmentService.listActiveMappings.mockResolvedValue([{ deviceId: 'AM_R1382' }]);

    const result = await AdminDevicesStationsService.listDevices({ includeSummary: true });

    expect(result.total).toBe(1);
    expect(result.summary).toMatchObject({ total: 2, active: 1, unlinked: 1, tunneled: 1 });
  });

  it('joins a registry-selected port to bounded host listener evidence', async () => {
    TunnelEnrollmentService.listActiveMappings.mockResolvedValue([{ deviceId: 'AM_R1382', remotePort: 22012, createdAt: '2026-07-01T00:00:00.000Z' }]);
    AdminHostTelemetryClient.getResource.mockResolvedValue({
      status: 'available',
      observedAt: '2026-08-02T01:02:03.000Z',
      data: {
        listenerPorts: [22012, 22020],
        portRange: { start: 22000, end: 22999 },
        limitations: 'Listener presence is point-in-time evidence only.',
      },
      operational: { state: 'healthy' },
    });

    const result = await AdminDevicesStationsService.getTunnelObservation({ deviceId: 'am_r1382', req: { accountId: 'account-1' } });

    expect(AdminHostTelemetryClient.getResource).toHaveBeenCalledWith('wstunnel', { accountId: 'account-1' });
    expect(result).toMatchObject({
      deviceId: 'AM_R1382',
      mapping: { remotePort: 22012 },
      observation: {
        state: 'listener_observed',
        listenerPresent: true,
        source: 'deployment-host-proc-net',
      },
    });
  });

  it('does not interpret unavailable host evidence as a disconnected tunnel', async () => {
    TunnelEnrollmentService.listActiveMappings.mockResolvedValue([{ deviceId: 'AM_R1382', remotePort: 22012 }]);
    AdminHostTelemetryClient.getResource.mockResolvedValue({
      status: 'unavailable',
      observedAt: null,
      errorCode: 'not_configured',
      operational: { state: 'unavailable' },
    });

    const result = await AdminDevicesStationsService.getTunnelObservation({ deviceId: 'AM_R1382' });

    expect(result.observation).toMatchObject({
      state: 'unavailable',
      listenerPresent: null,
      errorCode: 'not_configured',
    });
  });

  it('does not request host telemetry when no active mapping exists', async () => {
    TunnelEnrollmentService.listActiveMappings.mockResolvedValue([]);

    const result = await AdminDevicesStationsService.getTunnelObservation({ deviceId: 'AM_R1382' });

    expect(result.observation.state).toBe('not_mapped');
    expect(AdminHostTelemetryClient.getResource).not.toHaveBeenCalled();
  });
});
