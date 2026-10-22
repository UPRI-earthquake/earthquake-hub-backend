jest.mock('../src/repositories/accounts.repo', () => ({}));
jest.mock('../src/repositories/devices.repo', () => ({
  findByMacAddressOrStreamId: jest.fn(),
  findAccountsListing: jest.fn(),
  removeFromAllAccounts: jest.fn(),
  clearReleases: jest.fn(),
  remove: jest.fn(),
}));

const DevicesRepo = require('../src/repositories/devices.repo');
const DeviceService = require('../src/services/device.service');

describe('DeviceService.resetDeviceLink', () => {
  const device = {
    id: 'device-1',
    streamId: 'AM_TEST1_.*/MSEED',
    macAddress: 'AA:BB:CC:DD:EE:FF',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    DevicesRepo.findByMacAddressOrStreamId.mockResolvedValue([device]);
  });

  it('clears linked and released account references before deleting the device', async () => {
    DevicesRepo.findAccountsListing.mockResolvedValue([{ id: 'account-1', username: 'sensor-user' }]);

    const result = await DeviceService.resetDeviceLink('sensor-user', 'AA:BB:CC:DD:EE:FF', 'AM_TEST1_.*/MSEED');

    expect(result).toEqual({
      str: 'success',
      payload: { removedAccounts: ['sensor-user'], ownershipConfirmed: true },
    });
    expect(DevicesRepo.findByMacAddressOrStreamId).toHaveBeenCalledWith({
      macAddress: 'AA:BB:CC:DD:EE:FF',
      streamId: 'AM_TEST1_.*/MSEED',
    });
    expect(DevicesRepo.removeFromAllAccounts).toHaveBeenCalledWith('device-1');
    expect(DevicesRepo.clearReleases).toHaveBeenCalledWith({
      deviceId: 'device-1',
      streamId: 'AM_TEST1_.*/MSEED',
      macAddress: 'AA:BB:CC:DD:EE:FF',
    });
    expect(DevicesRepo.remove).toHaveBeenCalledWith('device-1');
    // References are cleared before the device goes
    expect(DevicesRepo.removeFromAllAccounts.mock.invocationCallOrder[0])
      .toBeLessThan(DevicesRepo.remove.mock.invocationCallOrder[0]);
  });

  it('requires sign-in when an account still lists the device', async () => {
    DevicesRepo.findAccountsListing.mockResolvedValue([{ id: 'account-1', username: 'sensor-user' }]);

    const result = await DeviceService.resetDeviceLink(null, 'AA:BB:CC:DD:EE:FF', 'AM_TEST1_.*/MSEED');

    expect(result).toEqual({ str: 'authRequired', linkedUsernames: ['sensor-user'] });
    expect(DevicesRepo.remove).not.toHaveBeenCalled();
  });

  it("refuses to reset another account's device", async () => {
    DevicesRepo.findAccountsListing.mockResolvedValue([{ id: 'account-2', username: 'someone-else' }]);

    const result = await DeviceService.resetDeviceLink('sensor-user', 'AA:BB:CC:DD:EE:FF', 'AM_TEST1_.*/MSEED');

    expect(result).toEqual({ str: 'deviceOwnedElsewhere', linkedUsernames: ['someone-else'] });
    expect(DevicesRepo.remove).not.toHaveBeenCalled();
  });

  it('reports identifiers that point to different devices', async () => {
    DevicesRepo.findByMacAddressOrStreamId.mockResolvedValue([device, { ...device, id: 'device-2' }]);

    const result = await DeviceService.resetDeviceLink('sensor-user', 'AA:BB:CC:DD:EE:FF', 'AM_TEST1_.*/MSEED');

    expect(result).toEqual({ str: 'identifierMismatch' });
  });

  it('needs at least one identifier', async () => {
    await expect(DeviceService.resetDeviceLink('sensor-user', null, null)).resolves.toEqual({ str: 'missingIdentifiers' });
    expect(DevicesRepo.findByMacAddressOrStreamId).not.toHaveBeenCalled();
  });
});
