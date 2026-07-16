const jwt = require('jsonwebtoken');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB = 'test-web-secret';
process.env.REFRESH_TOKEN_PRIVATE_KEY_WEB = 'test-refresh-secret';

jest.mock('../src/services/adminArchiveStorage.service', () => ({ getSnapshot: jest.fn() }));

const AdminArchiveStorageService = require('../src/services/adminArchiveStorage.service');
const app = require('../src/app');

function signAdminToken() {
  return jwt.sign({ accountId: 'account-1', username: 'admin-user', role: 'admin' }, process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB, { expiresIn: '1h' });
}

describe('Admin archive and storage routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('requires an administrator session', async () => {
    const response = await request(app).get('/admin/archive-storage/snapshot');
    expect(response.statusCode).toBe(403);
    expect(AdminArchiveStorageService.getSnapshot).not.toHaveBeenCalled();
  });

  it('returns read-only archive monitoring and gap diagnostics', async () => {
    AdminArchiveStorageService.getSnapshot.mockResolvedValue({ summary: { partialEvents: 2 }, gaps: [] });
    const response = await request(app).get('/admin/archive-storage/snapshot?windowHours=72&limit=15').set('Cookie', [`accessToken=${signAdminToken()}`]);
    expect(response.statusCode).toBe(200);
    expect(response.body.payload.summary.partialEvents).toBe(2);
    expect(AdminArchiveStorageService.getSnapshot).toHaveBeenCalledWith(
      { windowHours: 72, limit: 15 },
      expect.objectContaining({ accountId: 'account-1', role: 'admin' }),
    );
  });
});
