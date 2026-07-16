const jwt = require('jsonwebtoken');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB = 'test-web-secret';
process.env.REFRESH_TOKEN_PRIVATE_KEY_WEB = 'test-refresh-secret';

jest.mock('../src/services/adminInventoryImport.service', () => ({ getWorkflow: jest.fn() }));

const AdminInventoryImportService = require('../src/services/adminInventoryImport.service');
const app = require('../src/app');

function signAdminToken() {
  return jwt.sign({ accountId: 'account-1', username: 'admin-user', role: 'admin' }, process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB, { expiresIn: '1h' });
}

describe('Admin SeisComP inventory import workflow routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('requires an administrator session', async () => {
    const response = await request(app).get('/admin/inventory-import/workflow');
    expect(response.statusCode).toBe(403);
    expect(AdminInventoryImportService.getWorkflow).not.toHaveBeenCalled();
  });

  it('returns the host-safe inventory import workflow', async () => {
    AdminInventoryImportService.getWorkflow.mockResolvedValue({ capabilities: { applyEnabled: false }, stations: [{ id: 'AM_R1382' }] });
    const response = await request(app).get('/admin/inventory-import/workflow').set('Cookie', [`accessToken=${signAdminToken()}`]);
    expect(response.statusCode).toBe(200);
    expect(response.body.payload.capabilities.applyEnabled).toBe(false);
  });
});
