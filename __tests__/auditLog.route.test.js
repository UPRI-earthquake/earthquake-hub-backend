const jwt = require('jsonwebtoken');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB = 'test-web-secret';
process.env.REFRESH_TOKEN_PRIVATE_KEY_WEB = 'test-refresh-secret';

jest.mock('../src/services/auditLog.service', () => ({ list: jest.fn() }));

const AuditLogService = require('../src/services/auditLog.service');
const app = require('../src/app');

function signAdminToken() {
  return jwt.sign(
    { accountId: 'account-1', username: 'admin-user', role: 'admin' },
    process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB,
    { expiresIn: '1h' },
  );
}

describe('Audit log route', () => {
  beforeEach(() => jest.clearAllMocks());

  it('requires an admin session', async () => {
    const response = await request(app).get('/admin/audit-logs');
    expect(response.statusCode).toBe(403);
    expect(AuditLogService.list).not.toHaveBeenCalled();
  });

  it('returns filtered records to an administrator', async () => {
    AuditLogService.list.mockResolvedValue({
      logs: [{ _id: 'audit-1', eventType: 'device.tunnel.restart', outcome: 'succeeded' }],
      total: 1,
      limit: 10,
      offset: 0,
    });
    const token = signAdminToken();
    const response = await request(app)
      .get('/admin/audit-logs?outcome=succeeded&limit=10')
      .set('Cookie', [`accessToken=${token}`]);

    expect(response.statusCode).toBe(200);
    expect(AuditLogService.list).toHaveBeenCalledWith({ outcome: 'succeeded' }, expect.objectContaining({ limit: 10, offset: 0 }));
    expect(response.body.payload).toHaveLength(1);
  });
});
