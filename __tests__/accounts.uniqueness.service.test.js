// The User model is mocked as a constructor whose instances' save() can be made to fail,
// to simulate a second sign-up that passed the pre-checks but lost the race to the unique index.
const mockSave = jest.fn();
jest.mock('../src/models/account.model', () => {
  const User = jest.fn().mockImplementation(() => ({ save: mockSave }));
  User.findOne = jest.fn();
  return User;
});

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

const User = require('../src/models/account.model');
const AccountsService = require('../src/services/accounts.service');

const duplicateKeyError = (keyPattern) =>
  Object.assign(new Error('E11000 duplicate key error'), { code: 11000, keyPattern });

describe('accounts.service uniqueness', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    User.findOne.mockResolvedValue(null); // pre-checks pass, as they would for both racing requests
  });

  it('looks up emails by exact normalized value, not a regex', async () => {
    mockSave.mockResolvedValue({});

    await AccountsService.createUniqueAccount('citizen', 'juan', '  Juan@Example.COM ', 'pw');

    expect(User.findOne).toHaveBeenCalledWith({ email: 'juan@example.com' });
  });

  it.each([
    [{ email: 1 }, 'emailExists'],
    [{ username: 1 }, 'usernameExists'],
  ])('maps a duplicate-key error on %j to %s', async (keyPattern, expected) => {
    mockSave.mockRejectedValue(duplicateKeyError(keyPattern));

    const result = await AccountsService.createUniqueAccount('citizen', 'juan', 'juan@example.com', 'pw');

    expect(result).toBe(expected);
  });

  it('rethrows errors that are not duplicate keys', async () => {
    mockSave.mockRejectedValue(new Error('connection lost'));

    await expect(
      AccountsService.createUniqueAccount('citizen', 'juan', 'juan@example.com', 'pw')
    ).rejects.toThrow('connection lost');
  });
});
