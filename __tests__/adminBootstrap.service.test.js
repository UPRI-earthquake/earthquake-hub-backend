jest.mock('../src/models/account.model', () => ({
  create: jest.fn(),
  deleteOne: jest.fn(),
  exists: jest.fn(),
}));
jest.mock('../src/services/auditLog.service', () => ({ record: jest.fn() }));

const mongoose = require('mongoose');
const Account = require('../src/models/account.model');
const AuditLogService = require('../src/services/auditLog.service');
const { bootstrapFirstAdmin } = require('../src/services/adminBootstrap.service');

describe('first admin bootstrap', () => {
  const lockCollection = { deleteOne: jest.fn(), insertOne: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(mongoose.connection, 'collection').mockReturnValue(lockCollection);
    lockCollection.insertOne.mockResolvedValue({ acknowledged: true });
    lockCollection.deleteOne.mockResolvedValue({ deletedCount: 1 });
    Account.exists.mockResolvedValue(null);
    AuditLogService.record.mockResolvedValue({});
  });

  afterEach(() => jest.restoreAllMocks());

  it('creates an approved admin with the current password policy and audit lifecycle', async () => {
    Account.create.mockImplementation(async (document) => ({ _id: 'admin-1', ...document }));

    const result = await bootstrapFirstAdmin({
      username: 'ops-admin',
      email: 'OPS@example.org',
      password: 'Strong bootstrap passphrase 2026!',
    });

    expect(Account.create).toHaveBeenCalledWith(expect.objectContaining({
      email: 'ops@example.org',
      isApproved: true,
      password: expect.not.stringContaining('Strong bootstrap'),
      passwordPolicyVersion: 2,
      roles: ['admin'],
      username: 'ops-admin',
    }));
    expect(AuditLogService.record).toHaveBeenCalledTimes(2);
    expect(AuditLogService.record.mock.calls[0][1]).toEqual(expect.objectContaining({
      eventType: 'admin.account.bootstrap', outcome: 'started',
    }));
    expect(AuditLogService.record.mock.calls[1][1]).toEqual(expect.objectContaining({
      eventType: 'admin.account.bootstrap', outcome: 'succeeded',
    }));
    expect(result).toEqual({
      accountId: 'admin-1',
      adminRole: 'super_admin',
      email: 'ops@example.org',
      username: 'ops-admin',
    });
  });

  it('refuses to run when any admin already exists', async () => {
    Account.exists.mockResolvedValueOnce({ _id: 'existing-admin' });

    await expect(bootstrapFirstAdmin({
      username: 'ops-admin',
      email: 'ops@example.org',
      password: 'Strong bootstrap passphrase 2026!',
    })).rejects.toMatchObject({ code: 'ADMIN_ALREADY_EXISTS' });

    expect(lockCollection.insertOne).not.toHaveBeenCalled();
    expect(Account.create).not.toHaveBeenCalled();
  });

  it('rejects passwords that do not satisfy the current policy', async () => {
    await expect(bootstrapFirstAdmin({
      username: 'ops-admin',
      email: 'ops@example.org',
      password: 'password',
    })).rejects.toMatchObject({ name: 'ValidationError' });

    expect(Account.exists).not.toHaveBeenCalled();
  });

  it('rolls back the account when the success audit event cannot be stored', async () => {
    Account.create.mockResolvedValue({
      _id: 'admin-1', email: 'ops@example.org', username: 'ops-admin',
    });
    Account.deleteOne.mockResolvedValue({ deletedCount: 1 });
    AuditLogService.record
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('audit unavailable'))
      .mockResolvedValueOnce({});

    await expect(bootstrapFirstAdmin({
      username: 'ops-admin',
      email: 'ops@example.org',
      password: 'Strong bootstrap passphrase 2026!',
    })).rejects.toMatchObject({ code: 'ADMIN_BOOTSTRAP_AUDIT_FAILED' });

    expect(Account.deleteOne).toHaveBeenCalledWith({ _id: 'admin-1', roles: 'admin' });
    expect(AuditLogService.record.mock.calls[2][1]).toEqual(expect.objectContaining({
      eventType: 'admin.account.bootstrap', outcome: 'failed',
    }));
  });
});
