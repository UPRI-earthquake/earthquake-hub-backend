jest.mock('jsonwebtoken', () => ({
  verify: jest.fn(),
  sign: jest.fn(),
}));

jest.mock('../src/repositories/accounts.repo', () => ({
  findByUsername: jest.fn(),
}));
jest.mock('../src/repositories/devices.repo', () => ({
  listAccountDevices: jest.fn(),
  listAccountDeviceIds: jest.fn(),
  addToAccount: jest.fn(),
}));
jest.mock('../src/services/email.service', () => ({}));
jest.mock('../src/controllers/helpers', () => ({
  passwordSchema: jest.fn(),
  usernameSchema: jest.fn(),
  CURRENT_PASSWORD_POLICY_VERSION: 2,
  LEGACY_PASSWORD_POLICY_VERSION: 1,
  getPasswordResetSecret: jest.fn(() => 'reset-secret'),
  getAccessTokenSecret: jest.fn(() => 'device-secret'),
}));

const jwt = require('jsonwebtoken');
const AccountsRepo = require('../src/repositories/accounts.repo');
const DevicesRepo = require('../src/repositories/devices.repo');
const AccountsService = require('../src/services/accounts.service');

const decodesTo = (decoded) => {
  jwt.verify.mockImplementation((_token, _secret, callback) => callback(null, decoded));
};

describe('accounts.service verifySensorToken', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns JsonWebTokenError without touching the database', async () => {
    jwt.verify.mockImplementation((_token, _secret, callback) => {
      callback({ name: 'JsonWebTokenError' });
    });

    const result = await AccountsService.verifySensorToken('bad-token', 'brgy-user');

    expect(result).toEqual({ str: 'JsonWebTokenError' });
    expect(AccountsRepo.findByUsername).not.toHaveBeenCalled();
  });

  it('returns tokenRoleInvalid when decoded role is not sensor/brgy', async () => {
    decodesTo({ username: 'user1', role: 'citizen', exp: 1700000000 });

    const result = await AccountsService.verifySensorToken('valid-token', 'brgy-user');

    expect(result).toEqual({ str: 'tokenRoleInvalid' });
    expect(AccountsRepo.findByUsername).not.toHaveBeenCalled();
  });

  it('returns brgyNotFound when sensor is valid but requesting brgy account does not exist', async () => {
    AccountsRepo.findByUsername
      .mockResolvedValueOnce({ id: 'sensor-1', username: 'sensor-user' })
      .mockResolvedValueOnce(null);
    DevicesRepo.listAccountDevices.mockResolvedValue([]);
    decodesTo({ username: 'sensor-user', role: 'sensor', exp: 1700000000 });

    const result = await AccountsService.verifySensorToken('valid-token', 'missing-brgy');

    expect(result).toEqual({ str: 'brgyNotFound' });
    expect(AccountsRepo.findByUsername).toHaveBeenCalledTimes(2);
  });

  it("adds only the sensor's devices the brgy doesn't list yet", async () => {
    AccountsRepo.findByUsername
      .mockResolvedValueOnce({ id: 'sensor-1', username: 'sensor-user' })
      .mockResolvedValueOnce({ id: 'brgy-1', username: 'brgy-user' });
    DevicesRepo.listAccountDevices.mockResolvedValue([
      { id: 'device-1', streamId: 'AM_R0001_.*/MSEED' },
      { id: 'device-2', streamId: 'AM_R0002_.*/MSEED' },
    ]);
    DevicesRepo.listAccountDeviceIds.mockResolvedValue(['device-1']);
    decodesTo({ username: 'sensor-user', role: 'sensor', exp: 1700000000 });

    const result = await AccountsService.verifySensorToken('valid-token', 'brgy-user');

    expect(DevicesRepo.addToAccount).toHaveBeenCalledWith('brgy-1', ['device-2']);
    expect(result).toEqual({
      str: 'sensorIsValid',
      sensor: {
        username: 'sensor-user',
        role: 'sensor',
        streamIds: ['AM_R0001_.*/MSEED', 'AM_R0002_.*/MSEED'],
        tokenExp: 1700000000,
      },
    });
  });

  it('writes nothing when the brgy already lists every device', async () => {
    AccountsRepo.findByUsername
      .mockResolvedValueOnce({ id: 'sensor-1', username: 'sensor-user' })
      .mockResolvedValueOnce({ id: 'brgy-1', username: 'brgy-user' });
    DevicesRepo.listAccountDevices.mockResolvedValue([{ id: 'device-1', streamId: 'AM_R0001_.*/MSEED' }]);
    DevicesRepo.listAccountDeviceIds.mockResolvedValue(['device-1']);
    decodesTo({ username: 'sensor-user', role: 'brgy', exp: 1700000000 });

    await AccountsService.verifySensorToken('valid-token', 'brgy-user');

    expect(DevicesRepo.addToAccount).not.toHaveBeenCalled();
  });
});
