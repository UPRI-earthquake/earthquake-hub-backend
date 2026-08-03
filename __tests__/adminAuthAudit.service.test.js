jest.mock('../src/services/auditLog.service', () => ({ record: jest.fn() }));

const AuditLogService = require('../src/services/auditLog.service');
const AdminAuthAuditService = require('../src/services/adminAuthAudit.service');

describe('admin authentication audit service', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does not persist a rejected sign-in identifier in clear text', async () => {
    await AdminAuthAuditService.recordAuthentication(
      { ip: '192.0.2.10', headers: {} },
      {
        identifier: 'admin@example.com',
        outcome: 'rejected',
        reasonCode: 'invalid_credentials',
      },
    );

    const [, event] = AuditLogService.record.mock.calls[0];
    expect(event.eventType).toBe('admin.authentication');
    expect(event.outcome).toBe('rejected');
    expect(event.target.id).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(event)).not.toContain('admin@example.com');
    expect(JSON.stringify(event)).not.toMatch(/password/i);
  });

  it('attributes a successful sign-in to the authenticated administrator', async () => {
    await AdminAuthAuditService.recordAuthentication(
      { ip: '192.0.2.10', headers: {} },
      {
        accountId: 'account-1',
        identifier: 'admin-user',
        outcome: 'succeeded',
        reasonCode: 'credentials_verified',
        username: 'admin-user',
      },
    );

    const [request, event] = AuditLogService.record.mock.calls[0];
    expect(request).toEqual(expect.objectContaining({
      accountId: 'account-1',
      role: 'admin',
      username: 'admin-user',
    }));
    expect(event.target).toEqual({ type: 'admin_account', id: 'account-1', label: 'admin-user' });
  });
});
