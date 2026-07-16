const jwt = require('jsonwebtoken');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB = 'test-web-secret';
process.env.REFRESH_TOKEN_PRIVATE_KEY_WEB = 'test-refresh-secret';

jest.mock('../src/services/accounts.service', () => ({
  loginAccountRole: jest.fn(),
  getAccountProfile: jest.fn(),
}));

const AccountsService = require('../src/services/accounts.service');
const app = require('../src/app');

function signWebToken(payload = {}) {
  return jwt.sign(
    {
      accountId: 'account-1',
      username: 'admin-user',
      role: 'admin',
      ...payload,
    },
    process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB,
    { expiresIn: '1h' },
  );
}

describe('Admin routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('authenticates an admin account and sets web session cookies', async () => {
    AccountsService.loginAccountRole.mockResolvedValue({
      str: 'successAdmin',
      accountId: 'account-1',
      username: 'admin-user',
      email: 'admin@example.com',
      roles: ['admin'],
      passwordPolicyVersion: 2,
    });

    const response = await request(app)
      .post('/admin/authenticate')
      .send({ identifier: 'admin-user', password: 'valid-password' });

    expect(response.statusCode).toBe(200);
    expect(AccountsService.loginAccountRole).toHaveBeenCalledWith(
      'admin-user',
      'valid-password',
      'admin',
      { maskUserNotFound: true },
    );
    expect(response.headers['set-cookie']?.join(';')).toContain('accessToken=');
    expect(response.headers['set-cookie']?.join(';')).toContain('refreshToken=');
    expect(response.headers['set-cookie']?.join(';')).toContain('csrfToken=');
    expect(response.body?.payload?.profile?.username).toBe('admin-user');
  });

  it('rejects non-admin accounts at admin authentication', async () => {
    AccountsService.loginAccountRole.mockResolvedValue('invalidRole');

    const response = await request(app)
      .post('/admin/authenticate')
      .send({ identifier: 'citizen-user', password: 'valid-password' });

    expect(response.statusCode).toBe(403);
    expect(response.body?.message).toMatch(/Admin access/);
  });

  it('rate limits repeated admin login attempts for one identifier', async () => {
    AccountsService.loginAccountRole.mockResolvedValue('invalidCredentials');

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await request(app)
        .post('/admin/authenticate')
        .send({ identifier: 'rate-limit-admin', password: 'invalid-password' });
      expect(response.statusCode).toBe(401);
    }

    const response = await request(app)
      .post('/admin/authenticate')
      .send({ identifier: 'rate-limit-admin', password: 'invalid-password' });

    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBeDefined();
    expect(AccountsService.loginAccountRole).toHaveBeenCalledTimes(5);
  });

  it('returns 401 for admin profile without cookies', async () => {
    const response = await request(app).get('/admin/profile');

    expect(response.statusCode).toBe(401);
  });

  it('returns the admin profile for a valid admin session', async () => {
    AccountsService.getAccountProfile.mockResolvedValue({
      str: 'success',
      profile: {
        username: 'admin-user',
        email: 'admin@example.com',
        roles: ['admin'],
        passwordPolicyVersion: 2,
      },
    });

    const token = signWebToken();
    const response = await request(app)
      .get('/admin/profile')
      .set('Cookie', [`accessToken=${token}; refreshToken=${token}`]);

    expect(response.statusCode).toBe(200);
    expect(response.body?.payload?.profile).toEqual(
      expect.objectContaining({
        username: 'admin-user',
        email: 'admin@example.com',
        roles: ['admin'],
      }),
    );
  });

  it('clears session cookies on admin signout', async () => {
    const response = await request(app).post('/admin/signout');

    expect(response.statusCode).toBe(200);
    expect(response.headers['set-cookie']?.join(';')).toContain('accessToken=');
    expect(response.headers['set-cookie']?.join(';')).toContain('refreshToken=');
    expect(response.headers['set-cookie']?.join(';')).toContain('csrfToken=');
  });
});
