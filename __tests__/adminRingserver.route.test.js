const jwt = require('jsonwebtoken');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB = 'test-web-secret';
process.env.REFRESH_TOKEN_PRIVATE_KEY_WEB = 'test-refresh-secret';

jest.mock('../src/services/adminRingserver.service', () => ({
  RingserverMonitoringError: class RingserverMonitoringError extends Error { constructor(message) { super(message); this.name = 'RingserverMonitoringError'; } },
  getSnapshot: jest.fn(),
}));

const AdminRingserverService = require('../src/services/adminRingserver.service');
const app = require('../src/app');

function signAdminToken() {
  return jwt.sign({ accountId: 'account-1', username: 'admin-user', role: 'admin' }, process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB, { expiresIn: '1h' });
}

describe('Admin Ringserver monitoring routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('requires an administrator session for Ringserver monitoring', async () => {
    const response = await request(app).get('/admin/ringserver/snapshot');
    expect(response.statusCode).toBe(403);
    expect(AdminRingserverService.getSnapshot).not.toHaveBeenCalled();
  });

  it('returns a read-only Ringserver snapshot to administrators', async () => {
    AdminRingserverService.getSnapshot.mockResolvedValue({ summary: { activeConnections: 2, activeStreams: 8 } });
    const response = await request(app).get('/admin/ringserver/snapshot?connectionLimit=20&streamLimit=30').set('Cookie', [`accessToken=${signAdminToken()}`]);
    expect(response.statusCode).toBe(200);
    expect(response.body.payload.summary.activeStreams).toBe(8);
    expect(AdminRingserverService.getSnapshot).toHaveBeenCalledWith({ connectionLimit: 20, streamLimit: 30 });
  });

  it('returns an upstream monitoring error without adding any action route', async () => {
    AdminRingserverService.getSnapshot.mockRejectedValue(new AdminRingserverService.RingserverMonitoringError('Unable to retrieve the trusted Ringserver monitoring snapshot.'));
    const response = await request(app).get('/admin/ringserver/snapshot').set('Cookie', [`accessToken=${signAdminToken()}`]);
    expect(response.statusCode).toBe(502);
    expect(response.body.message).toMatch(/Unable to retrieve/);
    expect(response.body).toMatchObject({
      errorCode: 'RINGSERVER_MONITORING_UNAVAILABLE',
      retryable: true,
    });
  });
});
