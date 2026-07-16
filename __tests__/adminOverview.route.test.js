const jwt = require('jsonwebtoken');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB = 'test-web-secret';
process.env.REFRESH_TOKEN_PRIVATE_KEY_WEB = 'test-refresh-secret';

jest.mock('../src/services/adminOverview.service', () => ({ getSnapshot: jest.fn() }));

const AdminOverviewService = require('../src/services/adminOverview.service');
const app = require('../src/app');

function signAdminToken() {
  return jwt.sign({ accountId: 'account-1', username: 'admin-user', role: 'admin' }, process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB, { expiresIn: '1h' });
}

describe('Admin overview routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('requires an administrator session', async () => {
    const response = await request(app).get('/admin/overview/snapshot');
    expect(response.statusCode).toBe(403);
    expect(AdminOverviewService.getSnapshot).not.toHaveBeenCalled();
  });

  it('returns a partial-tolerant aggregate overview snapshot', async () => {
    AdminOverviewService.getSnapshot.mockResolvedValue({
      summary: { availableSources: 8, unavailableSources: 1 },
      sources: [{ id: 'ringserver', status: 'unavailable' }],
    });
    const response = await request(app)
      .get('/admin/overview/snapshot')
      .set('Cookie', ['accessToken=' + signAdminToken()]);
    expect(response.statusCode).toBe(200);
    expect(response.body.payload.summary.unavailableSources).toBe(1);
    expect(response.body.payload.sources[0].status).toBe('unavailable');
  });
});
