// Session tokens carry the account's MongoDB-style id (legacyId), not the repository's own id: on
// PostgreSQL those differ, and comments/contributions still store account ids as ObjectIds (Step 4).
jest.mock('../src/repositories/accounts.repo', () => ({
  findByUsername: jest.fn(),
  findByEmail: jest.fn(),
  update: jest.fn(),
}));
jest.mock('../src/repositories/devices.repo', () => ({}));
jest.mock('../src/services/email.service', () => ({}));

const bcrypt = require('bcryptjs');
const AccountsRepo = require('../src/repositories/accounts.repo');
const AccountsService = require('../src/services/accounts.service');

const PASSWORD = 'Golden-Password-2026!';

describe('accounts.service loginAccountRole', () => {
  const account = {
    id: '01890000-0000-7000-8000-000000000001', // a PostgreSQL uuid
    legacyId: '69000000000000000000a001',
    username: 'juan',
    email: 'juan@example.org',
    password: bcrypt.hashSync(PASSWORD, 4),
    roles: ['citizen', 'sensor'],
    passwordPolicyVersion: 2,
    alertPreferences: { rshakeEmailEnabled: false },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('a citizen sign-in returns the legacyId as accountId (for the session token)', async () => {
    AccountsRepo.findByUsername.mockResolvedValue(account);

    const result = await AccountsService.loginAccountRole('juan', PASSWORD, 'citizen');

    expect(result).toMatchObject({ str: 'successCitizen', accountId: '69000000000000000000a001', username: 'juan' });
  });

  test('signing in by email looks the account up by its normalized email', async () => {
    AccountsRepo.findByEmail.mockResolvedValue(account);

    const result = await AccountsService.loginAccountRole('  Juan@Example.org ', PASSWORD, 'citizen');

    expect(AccountsRepo.findByEmail).toHaveBeenCalledWith('juan@example.org');
    expect(result).toMatchObject({ accountId: '69000000000000000000a001' });
  });
});
