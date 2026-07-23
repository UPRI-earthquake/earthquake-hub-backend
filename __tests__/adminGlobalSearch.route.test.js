const jwt = require('jsonwebtoken');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB = 'test-web-secret';
process.env.REFRESH_TOKEN_PRIVATE_KEY_WEB = 'test-refresh-secret';

jest.mock('../src/services/adminGlobalSearch.service', () => ({ search: jest.fn() }));

const AdminGlobalSearchService = require('../src/services/adminGlobalSearch.service');
const app = require('../src/app');

function signAdminToken() {
  return jwt.sign(
    { accountId: 'admin-account', username: 'admin-user', role: 'admin' },
    process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB,
    { expiresIn: '1h' },
  );
}

describe('Admin global search route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    AdminGlobalSearchService.search.mockResolvedValue({
      query: 'Mindanao',
      groups: [],
      partial: false,
      returned: 0,
    });
  });

  it('requires an administrator session', async () => {
    const response = await request(app).get('/admin/search?q=Mindanao');
    expect(response.statusCode).toBe(403);
    expect(AdminGlobalSearchService.search).not.toHaveBeenCalled();
  });

  it('validates and forwards a bounded query', async () => {
    const response = await request(app)
      .get('/admin/search?q=Mindanao&limit=5')
      .set('Cookie', [`accessToken=${signAdminToken()}`]);

    expect(response.statusCode).toBe(200);
    expect(AdminGlobalSearchService.search).toHaveBeenCalledWith('Mindanao', { limit: 5 });
    expect(response.body.payload).toMatchObject({ query: 'Mindanao', returned: 0 });
  });

  it('rejects searches shorter than two characters', async () => {
    const response = await request(app)
      .get('/admin/search?q=M')
      .set('Cookie', [`accessToken=${signAdminToken()}`]);

    expect(response.statusCode).toBe(400);
    expect(AdminGlobalSearchService.search).not.toHaveBeenCalled();
  });
});
