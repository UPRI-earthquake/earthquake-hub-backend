const jwt = require('jsonwebtoken');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB = 'test-web-secret';
process.env.REFRESH_TOKEN_PRIVATE_KEY_WEB = 'test-refresh-secret';

jest.mock('../src/services/adminSystem.service', () => ({ getSnapshot: jest.fn() }));

const AdminSystemService = require('../src/services/adminSystem.service');
const app = require('../src/app');

function signAdminToken() {
  return jwt.sign(
    { accountId: 'account-1', username: 'admin-user', role: 'admin' },
    process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB,
    { expiresIn: '1h' },
  );
}

describe('Admin system resource routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('requires an administrator session', async () => {
    const response = await request(app).get('/admin/system/snapshot');
    expect(response.statusCode).toBe(403);
    expect(AdminSystemService.getSnapshot).not.toHaveBeenCalled();
  });

  it('returns read-only VM metrics and capability gates', async () => {
    AdminSystemService.getSnapshot.mockResolvedValue({
      status: 'available',
      metrics: { cpu: { utilizationPercent: 28 } },
      capabilities: { hostOperations: { available: false } },
    });
    const response = await request(app)
      .get('/admin/system/snapshot')
      .set('Cookie', [`accessToken=${signAdminToken()}`]);
    expect(response.statusCode).toBe(200);
    expect(response.body.payload.metrics.cpu.utilizationPercent).toBe(28);
    expect(response.body.payload.capabilities.hostOperations.available).toBe(false);
  });
});
