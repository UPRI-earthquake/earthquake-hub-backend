const jwt = require('jsonwebtoken');
const request = require('supertest');
process.env.NODE_ENV = 'test';
process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB = 'test-web-secret';
process.env.REFRESH_TOKEN_PRIVATE_KEY_WEB = 'test-refresh-secret';
jest.mock('../src/services/adminPreferences.service', () => ({ getPreferences: jest.fn(), savePreferences: jest.fn() }));
jest.mock('../src/services/auditLog.service', () => ({ record: jest.fn().mockResolvedValue({}) }));
const Preferences = require('../src/services/adminPreferences.service');
const app = require('../src/app');
const csrfToken = 'test-preferences-csrf';
const token = (role = 'admin') => jwt.sign({ accountId: 'own-account', username: 'viewer', role, adminRole: 'viewer', csrfToken }, process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB, { expiresIn: '1h' });
beforeEach(() => { jest.clearAllMocks(); Preferences.getPreferences.mockResolvedValue({ version: 0, dashboardLayout: null }); Preferences.savePreferences.mockResolvedValue({ version: 1, dashboardLayout: null }); });
test('preferences require administrator identity and accept no target account query', async () => {
  expect((await request(app).get('/admin/preferences')).status).toBe(403);
  expect((await request(app).get('/admin/preferences').set('Cookie', `accessToken=${token('citizen')}`)).status).toBe(403);
  expect((await request(app).get('/admin/preferences?accountId=other').set('Cookie', `accessToken=${token()}`)).status).toBe(400);
  expect(Preferences.getPreferences).not.toHaveBeenCalled();
});
test('viewer may save own layout with CSRF but cannot omit CSRF', async () => {
  expect((await request(app).put('/admin/preferences').set('Cookie', `accessToken=${token()}`).send({ version: 0, dashboardLayout: null })).status).toBe(403);
  expect(Preferences.savePreferences).not.toHaveBeenCalled();
  const response = await request(app).put('/admin/preferences').set('Cookie', [`accessToken=${token()}`, `csrfToken=${csrfToken}`]).set('X-CSRF-Token', csrfToken).send({ version: 0, dashboardLayout: null });
  expect(response.status).toBe(200);
  expect(Preferences.savePreferences).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'own-account' }), { version: 0, dashboardLayout: null });
});
