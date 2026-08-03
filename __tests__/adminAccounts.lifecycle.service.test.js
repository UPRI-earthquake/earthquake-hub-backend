jest.mock('../src/models/account.model', () => ({
  exists: jest.fn(),
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn(),
}));

const Account = require('../src/models/account.model');
const {
  revokeAccountSessions,
  setAccountLifecycle,
  setAdminRole,
} = require('../src/services/adminAccounts.service');

const accountId = '507f1f77bcf86cd799439011';
const otherAdminId = '507f191e810c19729de860ea';

function document(overrides = {}) {
  return {
    _id: accountId,
    username: 'target-admin',
    email: 'target@example.test',
    roles: ['admin'],
    adminRole: 'super_admin',
    isActive: true,
    sessionVersion: 2,
    devices: [],
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function selectedDocument(doc) {
  const query = {
    populate: jest.fn().mockResolvedValue(doc),
    select: jest.fn(),
  };
  query.select.mockReturnValue(query);
  return query;
}

describe('Admin account lifecycle controls', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deactivates an account, records evidence, and revokes prior sessions', async () => {
    const account = document({ adminRole: 'operator' });
    Account.findById.mockReturnValue(selectedDocument(account));

    const result = await setAccountLifecycle(accountId, false, {
      accountId: otherAdminId,
      username: 'security-admin',
      reason: 'Access is no longer required.',
    });

    expect(account).toMatchObject({
      isActive: false,
      sessionVersion: 3,
      deactivatedBy: 'security-admin',
      deactivationReason: 'Access is no longer required.',
    });
    expect(account.deactivatedAt).toBeInstanceOf(Date);
    expect(account.save).toHaveBeenCalledTimes(1);
    expect(result.account.lifecycleStatus).toBe('inactive');
  });

  it('blocks self-deactivation before changing the account', async () => {
    const account = document();
    Account.findById.mockReturnValue(selectedDocument(account));

    await expect(setAccountLifecycle(accountId, false, {
      accountId,
      username: 'target-admin',
      reason: 'Must not be allowed.',
    })).resolves.toEqual({ selfDeactivationBlocked: true });
    expect(account.save).not.toHaveBeenCalled();
  });

  it('keeps at least one active super-admin', async () => {
    const account = document();
    Account.findById.mockReturnValue(selectedDocument(account));
    Account.exists.mockResolvedValue(false);

    await expect(setAccountLifecycle(accountId, false, {
      accountId: otherAdminId,
      username: 'security-admin',
      reason: 'Would remove the final super-admin.',
    })).resolves.toEqual({ lastSuperAdminBlocked: true });
    expect(account.save).not.toHaveBeenCalled();
  });

  it('changes another admin privilege tier and revokes prior sessions', async () => {
    const account = document({ adminRole: 'operator' });
    Account.findById.mockReturnValue(selectedDocument(account));

    const result = await setAdminRole(accountId, 'viewer', {
      accountId: otherAdminId,
      username: 'security-admin',
    });

    expect(account).toMatchObject({ adminRole: 'viewer', sessionVersion: 3 });
    expect(account.save).toHaveBeenCalledTimes(1);
    expect(result.account.adminRole).toBe('viewer');
  });

  it('revokes all sessions by incrementing the account generation', async () => {
    const account = document({ sessionVersion: 8 });
    Account.findByIdAndUpdate.mockReturnValue(selectedDocument(account));

    const result = await revokeAccountSessions(accountId);

    expect(Account.findByIdAndUpdate).toHaveBeenCalledWith(
      accountId,
      { $inc: { sessionVersion: 1 } },
      { new: true },
    );
    expect(result.account.accountId).toBe(accountId);
  });
});
