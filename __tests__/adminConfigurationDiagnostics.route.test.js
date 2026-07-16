const jwt = require('jsonwebtoken');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB = 'test-web-secret';
process.env.REFRESH_TOKEN_PRIVATE_KEY_WEB = 'test-refresh-secret';

jest.mock('../src/services/adminConfigurationDiagnostics.service', () => ({ getSnapshot: jest.fn() }));

const AdminConfigurationDiagnosticsService = require('../src/services/adminConfigurationDiagnostics.service');
const app = require('../src/app');

function signAdminToken() {
  return jwt.sign({ accountId: 'account-1', username: 'admin-user', role: 'admin' }, process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB, { expiresIn: '1h' });
}

describe('Admin configuration diagnostics routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('requires an administrator session', async () => {
    const response = await request(app).get('/admin/configuration-diagnostics/snapshot');
    expect(response.statusCode).toBe(403);
    expect(AdminConfigurationDiagnosticsService.getSnapshot).not.toHaveBeenCalled();
  });

  it('returns masked, read-only configuration diagnostics', async () => {
    AdminConfigurationDiagnosticsService.getSnapshot.mockReturnValue({
      configurations: [{ id: 'node-environment', value: 'test' }],
      sensitiveSettings: [{ id: 'web-access-key', value: 'Configured (value masked)' }],
    });
    const response = await request(app)
      .get('/admin/configuration-diagnostics/snapshot')
      .set('Cookie', ['accessToken=' + signAdminToken()]);
    expect(response.statusCode).toBe(200);
    expect(response.body.payload.configurations[0].value).toBe('test');
    expect(response.body.payload.sensitiveSettings[0].value).toBe('Configured (value masked)');
  });
});
