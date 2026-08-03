jest.mock('../src/models/account.model', () => ({
  findOne: jest.fn(),
  updateOne: jest.fn(),
}));

const Account = require('../src/models/account.model');
const {
  ACTIVITY_WRITE_INTERVAL_MS,
  effectiveAdminRole,
  validateAccountSession,
  validateAdminSession,
} = require('../src/services/adminSession.service');

function accountQuery(account) {
  const query = {
    lean: jest.fn().mockResolvedValue(account),
    select: jest.fn(),
  };
  query.select.mockReturnValue(query);
  return query;
}

describe('AdminSessionService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('preserves legacy administrators as super-admins during migration', () => {
    expect(effectiveAdminRole({ roles: ['admin'] })).toBe('super_admin');
    expect(effectiveAdminRole({ adminRole: 'operator' })).toBe('operator');
  });

  it('validates the account generation and refreshes stale activity', async () => {
    Account.findOne.mockReturnValue(accountQuery({
      _id: '507f1f77bcf86cd799439011',
      username: 'ops-admin',
      roles: ['admin'],
      adminRole: 'operator',
      isActive: true,
      sessionVersion: 4,
      lastActivityAt: new Date(Date.now() - ACTIVITY_WRITE_INTERVAL_MS - 1),
    }));
    Account.updateOne.mockResolvedValue({});

    const result = await validateAdminSession({
      accountId: '507f1f77bcf86cd799439011',
      sessionVersion: 4,
    });

    expect(result).toEqual({
      valid: true,
      accountId: '507f1f77bcf86cd799439011',
      username: 'ops-admin',
      adminRole: 'operator',
      role: 'admin',
      sessionVersion: 4,
    });
    expect(Account.updateOne).toHaveBeenCalledWith(
      { _id: '507f1f77bcf86cd799439011' },
      { $set: { lastActivityAt: expect.any(Date) } },
    );
  });

  it.each([
    [{ roles: ['admin'], isActive: false, sessionVersion: 1 }, { reason: 'account_inactive' }],
    [{ roles: ['citizen'], isActive: true, sessionVersion: 1 }, { reason: 'admin_role_removed' }],
    [{ roles: ['admin'], isActive: true, sessionVersion: 2 }, { reason: 'session_revoked' }],
  ])('rejects invalid persisted account state %#', async (fields, expected) => {
    Account.findOne.mockReturnValue(accountQuery({
      _id: '507f1f77bcf86cd799439011',
      username: 'admin-user',
      ...fields,
    }));

    await expect(validateAdminSession({
      accountId: '507f1f77bcf86cd799439011',
      sessionVersion: 1,
    })).resolves.toEqual({ valid: false, ...expected });
    expect(Account.updateOne).not.toHaveBeenCalled();
  });

  it('rejects a deleted account', async () => {
    Account.findOne.mockReturnValue(accountQuery(null));

    await expect(validateAdminSession({
      username: 'missing-admin',
      sessionVersion: 0,
    })).resolves.toEqual({ valid: false, reason: 'account_missing' });
  });

  it('enforces lifecycle and session generation for non-admin accounts', async () => {
    Account.findOne.mockReturnValue(accountQuery({
      _id: '507f1f77bcf86cd799439011',
      username: 'citizen-user',
      roles: ['citizen'],
      isActive: true,
      sessionVersion: 3,
      lastActivityAt: new Date(),
    }));

    await expect(validateAccountSession({
      accountId: '507f1f77bcf86cd799439011',
      role: 'citizen',
      sessionVersion: 2,
    })).resolves.toEqual({ valid: false, reason: 'session_revoked' });
  });

  it('upgrades a legacy refresh only after validating current account state', async () => {
    Account.findOne.mockReturnValue(accountQuery({
      _id: '507f1f77bcf86cd799439011',
      username: 'citizen-user',
      roles: ['citizen'],
      isActive: true,
      sessionVersion: 0,
      lastActivityAt: new Date(),
    }));

    await expect(validateAccountSession(
      { username: 'citizen-user', role: 'citizen' },
      { allowLegacyGeneration: true },
    )).resolves.toEqual({
      valid: true,
      accountId: '507f1f77bcf86cd799439011',
      username: 'citizen-user',
      role: 'citizen',
      adminRole: undefined,
      sessionVersion: 0,
    });
  });

  it('does not let a legacy refresh bypass an explicit generation revocation', async () => {
    Account.findOne.mockReturnValue(accountQuery({
      _id: '507f1f77bcf86cd799439011',
      username: 'citizen-user',
      roles: ['citizen'],
      isActive: true,
      sessionVersion: 1,
      lastActivityAt: new Date(),
    }));

    await expect(validateAccountSession(
      { username: 'citizen-user', role: 'citizen' },
      { allowLegacyGeneration: true },
    )).resolves.toEqual({ valid: false, reason: 'session_revoked' });
  });
});
