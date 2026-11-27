// AccountsRepo.create can be made to fail with DuplicateKeyError, to simulate a second sign-up that
// passed the pre-checks but lost the race to the unique rule.
jest.mock('../src/repositories/accounts.repo', () => ({
  findByUsername: jest.fn(),
  findByEmail: jest.fn(),
  findByRingserverUrl: jest.fn(),
  create: jest.fn(),
}));
jest.mock('../src/repositories/devices.repo', () => ({}));
jest.mock('../src/services/email.service', () => ({}));
jest.mock('../src/controllers/helpers', () => ({
  passwordSchema: jest.fn(),
  usernameSchema: jest.fn(),
  CURRENT_PASSWORD_POLICY_VERSION: 2,
  LEGACY_PASSWORD_POLICY_VERSION: 1,
  getPasswordResetSecret: jest.fn(() => 'reset-secret'),
  getAccessTokenSecret: jest.fn(() => 'device-secret'),
}));

const AccountsRepo = require('../src/repositories/accounts.repo');
const { DuplicateKeyError, fromPostgresError } = require('../src/repositories/errors');
const AccountsService = require('../src/services/accounts.service');

describe('accounts.service uniqueness', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // pre-checks pass, as they would for both racing requests
    AccountsRepo.findByUsername.mockResolvedValue(null);
    AccountsRepo.findByEmail.mockResolvedValue(null);
    AccountsRepo.findByRingserverUrl.mockResolvedValue(null);
  });

  it('looks up emails by their normalized value', async () => {
    AccountsRepo.create.mockResolvedValue({});

    await AccountsService.createUniqueAccount('citizen', 'juan', '  Juan@Example.COM ', 'pw');

    expect(AccountsRepo.findByEmail).toHaveBeenCalledWith('juan@example.com');
    expect(AccountsRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      username: 'juan',
      email: 'juan@example.com',
      roles: ['citizen', 'sensor'],
    }));
  });

  it.each([
    [['email'], 'emailExists'],
    [['username'], 'usernameExists'],
    [['ringserverUrl'], 'ringserverUrlExists'],
  ])('maps a duplicate on %j to %s', async (fields, expected) => {
    AccountsRepo.create.mockRejectedValue(new DuplicateKeyError(fields));

    const result = await AccountsService.createUniqueAccount('citizen', 'juan', 'juan@example.com', 'pw');

    expect(result).toBe(expected);
  });

  it('rethrows errors that are not duplicates', async () => {
    AccountsRepo.create.mockRejectedValue(new Error('connection lost'));

    await expect(
      AccountsService.createUniqueAccount('citizen', 'juan', 'juan@example.com', 'pw')
    ).rejects.toThrow('connection lost');
  });
});

describe('repositories/errors fromPostgresError', () => {
  const uniqueViolation = (constraint) => Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505', constraint });

  it.each([
    ['accounts_email_unique', ['email']],
    ['accounts_username_unique', ['username']],
    ['devices_network_station_unique', ['network', 'station']],
    ['some_other_unique', ['some_other_unique']],
  ])('turns a unique violation of %s into DuplicateKeyError(%j)', (constraint, expected) => {
    const err = fromPostgresError(uniqueViolation(constraint));

    expect(err).toBeInstanceOf(DuplicateKeyError);
    expect(err.fields).toEqual(expected);
  });

  it('returns other errors unchanged', () => {
    const err = new Error('connection lost');

    expect(fromPostgresError(err)).toBe(err);
  });
});
