jest.mock('../src/models/device.model', () => ({
  find: jest.fn(),
  deleteOne: jest.fn(),
}));

jest.mock('../src/models/account.model', () => ({
  find: jest.fn(),
  updateMany: jest.fn(),
}));

const Device = require('../src/models/device.model');
const Account = require('../src/models/account.model');
const DeviceService = require('../src/services/device.service');

describe('DeviceService.resetDeviceLink', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('clears linked and released account references before deleting the device', async () => {
    const deviceDoc = {
      _id: 'device-1',
      id: 'device-1',
      streamId: 'AM_TEST1_.*/MSEED',
      macAddress: 'AA:BB:CC:DD:EE:FF',
    };

    Device.find.mockResolvedValue([deviceDoc]);
    Account.find.mockResolvedValue([{ username: 'sensor-user' }]);
    Account.updateMany
      .mockResolvedValueOnce({ modifiedCount: 1 })
      .mockResolvedValueOnce({ modifiedCount: 1 });
    Device.deleteOne.mockResolvedValue({ deletedCount: 1 });

    const result = await DeviceService.resetDeviceLink(
      'sensor-user',
      'AA:BB:CC:DD:EE:FF',
      'AM_TEST1_.*/MSEED',
    );

    expect(result.str).toBe('success');
    expect(Account.updateMany).toHaveBeenNthCalledWith(
      1,
      { devices: 'device-1' },
      { $pull: { devices: 'device-1' } },
    );
    expect(Account.updateMany).toHaveBeenNthCalledWith(
      2,
      {
        releasedDevices: {
          $elemMatch: {
            $or: [
              { deviceId: 'device-1' },
              { streamId: 'AM_TEST1_.*/MSEED' },
              { macAddress: 'AA:BB:CC:DD:EE:FF' },
            ],
          },
        },
      },
      {
        $pull: {
          releasedDevices: {
            $or: [
              { deviceId: 'device-1' },
              { streamId: 'AM_TEST1_.*/MSEED' },
              { macAddress: 'AA:BB:CC:DD:EE:FF' },
            ],
          },
        },
      },
      undefined,
    );
    expect(Device.deleteOne).toHaveBeenCalledWith({ _id: 'device-1' });
  });
});
