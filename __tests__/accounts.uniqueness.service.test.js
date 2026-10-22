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
const { DuplicateKeyError, fromMongoError } = require('../src/repositories/errors');
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

describe('repositories/errors fromMongoError', () => {
  const e11000 = (fields) => Object.assign(new Error('E11000 duplicate key error'), fields);

  it.each([
    [{ code: 11000, keyPattern: { email: 1 } }, ['email']],
    [{ code: 11000, keyValue: { username: 'juan' } }, ['username']],
    [{ code: 11000, keyPattern: { network: 1, station: 1 } }, ['network', 'station']],
  ])('turns E11000 %j into DuplicateKeyError(%j)', (fields, expected) => {
    const err = fromMongoError(e11000(fields));

    expect(err).toBeInstanceOf(DuplicateKeyError);
    expect(err.fields).toEqual(expected);
  });

  it('returns other errors unchanged', () => {
    const err = new Error('connection lost');

    expect(fromMongoError(err)).toBe(err);
  });
});
