const jwt = require('jsonwebtoken');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB = 'test-web-secret';
process.env.REFRESH_TOKEN_PRIVATE_KEY_WEB = 'test-refresh-secret';

jest.mock('../src/services/adminSeiscomp.service', () => ({ getSnapshot: jest.fn() }));

const AdminSeiscompService = require('../src/services/adminSeiscomp.service');
const app = require('../src/app');

function signAdminToken() {
  return jwt.sign({ accountId: 'account-1', username: 'admin-user', role: 'admin' }, process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB, { expiresIn: '1h' });
}

describe('Admin SeisComP monitoring routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('requires an administrator session', async () => {
    const response = await request(app).get('/admin/seiscomp/snapshot');
    expect(response.statusCode).toBe(403);
    expect(AdminSeiscompService.getSnapshot).not.toHaveBeenCalled();
  });

  it('returns the backend-observed SeisComP pipeline snapshot', async () => {
    AdminSeiscompService.getSnapshot.mockResolvedValue({ summary: { deliveredEvents: 3 }, modules: [] });
    const response = await request(app).get('/admin/seiscomp/snapshot?windowHours=12&limit=10').set('Cookie', [`accessToken=${signAdminToken()}`]);
    expect(response.statusCode).toBe(200);
    expect(response.body.payload.summary.deliveredEvents).toBe(3);
    expect(AdminSeiscompService.getSnapshot).toHaveBeenCalledWith(
      { windowHours: 12, limit: 10 },
      expect.objectContaining({ accountId: 'account-1', role: 'admin' }),
    );
  });
});
