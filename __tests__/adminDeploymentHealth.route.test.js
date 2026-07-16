const jwt = require('jsonwebtoken');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB = 'test-web-secret';
process.env.REFRESH_TOKEN_PRIVATE_KEY_WEB = 'test-refresh-secret';

jest.mock('../src/services/adminDeploymentHealth.service', () => ({ getSnapshot: jest.fn() }));

const AdminDeploymentHealthService = require('../src/services/adminDeploymentHealth.service');
const app = require('../src/app');

function signAdminToken() {
  return jwt.sign({ accountId: 'account-1', username: 'admin-user', role: 'admin' }, process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB, { expiresIn: '1h' });
}

describe('Admin deployment health routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('requires an administrator session', async () => {
    const response = await request(app).get('/admin/deployment-health/snapshot');
    expect(response.statusCode).toBe(403);
    expect(AdminDeploymentHealthService.getSnapshot).not.toHaveBeenCalled();
  });

  it('returns read-only health and operator log-access plans', async () => {
    AdminDeploymentHealthService.getSnapshot.mockReturnValue({
      summary: { observedServices: 1 },
      services: [{ id: 'ehub-backend', status: 'observed' }],
    });
    const response = await request(app)
      .get('/admin/deployment-health/snapshot')
      .set('Cookie', ['accessToken=' + signAdminToken()]);
    expect(response.statusCode).toBe(200);
    expect(response.body.payload.summary.observedServices).toBe(1);
    expect(response.body.payload.services[0].id).toBe('ehub-backend');
  });
});
