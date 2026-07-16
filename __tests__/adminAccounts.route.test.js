const jwt = require('jsonwebtoken');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB = 'test-web-secret';
process.env.REFRESH_TOKEN_PRIVATE_KEY_WEB = 'test-refresh-secret';

jest.mock('../src/services/adminAccounts.service', () => ({ listAccounts: jest.fn(), setBrgyApproval: jest.fn() }));
jest.mock('../src/services/auditLog.service', () => ({ execute: jest.fn() }));

const AdminAccountsService = require('../src/services/adminAccounts.service');
const AuditLogService = require('../src/services/auditLog.service');
const app = require('../src/app');
const accountId = '507f1f77bcf86cd799439011';
const csrfToken = 'test-admin-csrf-token';

function signAdminToken(options = {}) {
  return jwt.sign({ accountId: 'admin-account', username: 'admin-user', role: 'admin', csrfToken, ...options }, process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB, { expiresIn: options.expiresIn || '1h' });
}
function adminCookies(token = signAdminToken()) { return [`accessToken=${token}`, `csrfToken=${csrfToken}`]; }

describe('Admin account routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    AuditLogService.execute.mockImplementation(async (_req, _event, operation) => operation());
  });

  it('requires an administrator session for the account directory', async () => {
    const response = await request(app).get('/admin/accounts');
    expect(response.statusCode).toBe(403);
    expect(AdminAccountsService.listAccounts).not.toHaveBeenCalled();
  });

  it('lists canonical account approval states', async () => {
    AdminAccountsService.listAccounts.mockResolvedValue({ accounts: [{ accountId, approvalStatus: 'pending', roles: ['brgy'] }], total: 1, limit: 25, offset: 0 });
    const response = await request(app).get('/admin/accounts?approvalStatus=pending&role=brgy').set('Cookie', [`accessToken=${signAdminToken()}`]);
    expect(response.statusCode).toBe(200);
    expect(AdminAccountsService.listAccounts).toHaveBeenCalledWith(expect.objectContaining({ approvalStatus: 'pending', role: 'brgy', limit: 25, offset: 0 }));
  });

  it('audits brgy approval before applying it', async () => {
    AdminAccountsService.setBrgyApproval.mockResolvedValue({ account: { accountId, approvalStatus: 'approved' } });
    const response = await request(app)
      .patch(`/admin/accounts/${accountId}/approval`)
      .set('Cookie', adminCookies())
      .set('X-CSRF-Token', csrfToken)
      .send({ approved: true, reason: 'Verified authorized barangay ringserver operator.' });
    expect(response.statusCode).toBe(200);
    expect(AuditLogService.execute).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: 'account.brgy.approve', target: { type: 'account', id: accountId, label: accountId },
    }), expect.any(Function));
    expect(AdminAccountsService.setBrgyApproval).toHaveBeenCalledWith(accountId, true);
  });

  it('rejects approval changes for a non-brgy account', async () => {
    AdminAccountsService.setBrgyApproval.mockResolvedValue({ approvalNotApplicable: true });
    const response = await request(app)
      .patch(`/admin/accounts/${accountId}/approval`)
      .set('Cookie', adminCookies())
      .set('X-CSRF-Token', csrfToken)
      .send({ approved: false, reason: 'This must not alter citizen lifecycle.' });
    expect(response.statusCode).toBe(409);
  });

  it('rejects a mutation without a CSRF token before auditing or changing data', async () => {
    const response = await request(app)
      .patch(`/admin/accounts/${accountId}/approval`)
      .set('Cookie', [`accessToken=${signAdminToken()}`])
      .send({ approved: true, reason: 'Must be rejected before the operation.' });

    expect(response.statusCode).toBe(403);
    expect(response.body.message).toMatch(/CSRF/);
    expect(AuditLogService.execute).not.toHaveBeenCalled();
    expect(AdminAccountsService.setBrgyApproval).not.toHaveBeenCalled();
  });

  it('rejects an expired admin session before CSRF or audit processing', async () => {
    const expiredToken = signAdminToken({ expiresIn: '-1s' });
    const response = await request(app)
      .patch(`/admin/accounts/${accountId}/approval`)
      .set('Cookie', adminCookies(expiredToken))
      .set('X-CSRF-Token', csrfToken)
      .send({ approved: true, reason: 'Expired sessions cannot mutate accounts.' });

    expect(response.statusCode).toBe(403);
    expect(response.body.message).toMatch(/expired/i);
    expect(AuditLogService.execute).not.toHaveBeenCalled();
  });
});
