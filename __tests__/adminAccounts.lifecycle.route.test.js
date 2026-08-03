const jwt = require('jsonwebtoken');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB = 'test-web-secret';
process.env.REFRESH_TOKEN_PRIVATE_KEY_WEB = 'test-refresh-secret';

jest.mock('../src/services/adminAccounts.service', () => ({
  listAccounts: jest.fn(),
  revokeAccountSessions: jest.fn(),
  setAccountLifecycle: jest.fn(),
  setAdminRole: jest.fn(),
  setBrgyApproval: jest.fn(),
}));
jest.mock('../src/services/auditLog.service', () => ({
  execute: jest.fn(),
  record: jest.fn(),
}));

const AdminAccountsService = require('../src/services/adminAccounts.service');
const AuditLogService = require('../src/services/auditLog.service');
const app = require('../src/app');

const accountId = '507f1f77bcf86cd799439011';
const csrfToken = 'account-security-csrf-token';

function signAdminToken({
  adminRole = 'super_admin',
  authTime = Math.floor(Date.now() / 1000),
} = {}) {
  return jwt.sign(
    {
      accountId: 'security-admin',
      username: 'security-admin',
      role: 'admin',
      adminRole,
      authTime,
      csrfToken,
    },
    process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB,
    { expiresIn: '1h' },
  );
}

function adminCookies(options) {
  return [
    `accessToken=${signAdminToken(options)}`,
    `csrfToken=${csrfToken}`,
  ];
}

describe('Admin account lifecycle routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    AuditLogService.execute.mockImplementation(async (_req, _event, operation) => operation());
  });

  it('deactivates another account with recent auth and typed confirmation', async () => {
    AdminAccountsService.setAccountLifecycle.mockResolvedValue({
      account: { accountId, lifecycleStatus: 'inactive' },
    });

    const response = await request(app)
      .patch(`/admin/accounts/${accountId}/lifecycle`)
      .set('Cookie', adminCookies())
      .set('X-CSRF-Token', csrfToken)
      .send({
        active: false,
        confirmation: accountId,
        reason: 'This account no longer requires administrative access.',
      });

    expect(response.statusCode).toBe(200);
    expect(AdminAccountsService.setAccountLifecycle).toHaveBeenCalledWith(
      accountId,
      false,
      {
        accountId: 'security-admin',
        username: 'security-admin',
        reason: 'This account no longer requires administrative access.',
      },
    );
    expect(AuditLogService.execute).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'account.lifecycle.deactivate' }),
      expect.any(Function),
    );
  });

  it('rejects a high-risk account change when authentication is stale', async () => {
    const response = await request(app)
      .patch(`/admin/accounts/${accountId}/lifecycle`)
      .set('Cookie', adminCookies({
        authTime: Math.floor(Date.now() / 1000) - 3600,
      }))
      .set('X-CSRF-Token', csrfToken)
      .send({
        active: false,
        confirmation: accountId,
        reason: 'Stale authentication must not authorize this change.',
      });

    expect(response.statusCode).toBe(403);
    expect(response.body.errorCode).toBe('ADMIN_REAUTHENTICATION_REQUIRED');
    expect(AdminAccountsService.setAccountLifecycle).not.toHaveBeenCalled();
    expect(AuditLogService.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'admin.reauthentication.required' }),
    );
  });

  it('rejects an operator attempting a super-admin account action', async () => {
    const response = await request(app)
      .post(`/admin/accounts/${accountId}/sessions/revoke`)
      .set('Cookie', adminCookies({ adminRole: 'operator' }))
      .set('X-CSRF-Token', csrfToken)
      .send({ reason: 'Operators must not revoke account sessions.' });

    expect(response.statusCode).toBe(403);
    expect(response.body.errorCode).toBe('ADMIN_CAPABILITY_DISABLED');
    expect(AdminAccountsService.revokeAccountSessions).not.toHaveBeenCalled();
  });

  it('requires an exact account identifier before changing an admin tier', async () => {
    const response = await request(app)
      .patch(`/admin/accounts/${accountId}/admin-role`)
      .set('Cookie', adminCookies())
      .set('X-CSRF-Token', csrfToken)
      .send({
        adminRole: 'viewer',
        confirmation: 'wrong-account',
        reason: 'The typed target must match exactly.',
      });

    expect(response.statusCode).toBe(400);
    expect(response.body.errorCode).toBe('ADMIN_CONFIRMATION_MISMATCH');
    expect(AdminAccountsService.setAdminRole).not.toHaveBeenCalled();
  });
});
