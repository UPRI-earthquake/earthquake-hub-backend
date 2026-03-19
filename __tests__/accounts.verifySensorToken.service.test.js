jest.mock('jsonwebtoken', () => ({
  verify: jest.fn(),
  sign: jest.fn(),
}));

jest.mock('../src/models/account.model', () => ({
  findOne: jest.fn(),
}));

jest.mock('../src/models/device.model', () => ({}));
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
const User = require('../src/models/account.model');
const AccountsService = require('../src/services/accounts.service');

describe('accounts.service verifySensorToken', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns JsonWebTokenError without touching database', async () => {
    jwt.verify.mockImplementation((_token, _secret, callback) => {
      callback({ name: 'JsonWebTokenError' });
    });

    const result = await AccountsService.verifySensorToken('bad-token', 'brgy-user');

    expect(result).toEqual({ str: 'JsonWebTokenError' });
    expect(User.findOne).not.toHaveBeenCalled();
  });

  it('returns tokenRoleInvalid when decoded role is not sensor/brgy', async () => {
    jwt.verify.mockImplementation((_token, _secret, callback) => {
      callback(null, {
        username: 'user1',
        role: 'citizen',
        exp: 1700000000,
      });
    });

    const result = await AccountsService.verifySensorToken('valid-token', 'brgy-user');

    expect(result).toEqual({ str: 'tokenRoleInvalid' });
    expect(User.findOne).not.toHaveBeenCalled();
  });

  it('returns brgyNotFound when sensor is valid but requesting brgy account does not exist', async () => {
    const populate = jest.fn().mockResolvedValue({
      devices: [],
    });

    User.findOne
      .mockImplementationOnce(() => ({ populate }))
      .mockResolvedValueOnce(null);

    jwt.verify.mockImplementation((_token, _secret, callback) => {
      callback(null, {
        username: 'sensor-user',
        role: 'sensor',
        exp: 1700000000,
      });
    });

    const result = await AccountsService.verifySensorToken('valid-token', 'missing-brgy');

    expect(result).toEqual({ str: 'brgyNotFound' });
    expect(User.findOne).toHaveBeenCalledTimes(2);
  });
});
