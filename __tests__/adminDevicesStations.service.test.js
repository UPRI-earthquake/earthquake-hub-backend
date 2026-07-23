jest.mock('../src/models/device.model', () => ({ find: jest.fn() }));
jest.mock('../src/services/tunnelEnrollment.service', () => ({ listActiveMappings: jest.fn() }));

const Device = require('../src/models/device.model');
const TunnelEnrollmentService = require('../src/services/tunnelEnrollment.service');
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
});
