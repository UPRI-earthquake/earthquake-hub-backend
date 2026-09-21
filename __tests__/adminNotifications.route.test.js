const jwt = require('jsonwebtoken');
const request = require('supertest');
process.env.NODE_ENV = 'test';
process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB = 'test-web-secret';
process.env.REFRESH_TOKEN_PRIVATE_KEY_WEB = 'test-refresh-secret';
jest.mock('../src/services/adminNotifications.service', () => ({
  getRule: jest.fn(), saveRule: jest.fn(), getPreferences: jest.fn(), savePreferences: jest.fn(), listDeliveries: jest.fn(),
}));
jest.mock('../src/services/notifications.service', () => ({
  createSubscription: jest.fn(),
  notifySubscribersEQ: jest.fn(),
}));
jest.mock('../src/services/auditLog.service', () => ({
  record: jest.fn().mockResolvedValue({}),
  execute: jest.fn(),
}));
const Notifications = require('../src/services/adminNotifications.service');
const app = require('../src/app');
const csrfToken = 'notification-csrf';
function token(adminRole = 'viewer', role = 'admin') { return jwt.sign({ accountId: 'own-account', username: 'admin', role, adminRole, csrfToken }, process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB, { expiresIn: '1h' }); }
function cookies(adminRole) { return [`accessToken=${token(adminRole)}`, `csrfToken=${csrfToken}`]; }
beforeEach(() => { jest.clearAllMocks(); Notifications.getPreferences.mockResolvedValue({ incidentEmailEnabled: false }); Notifications.getRule.mockResolvedValue({ key: 'overview_source_unavailable', version: 0, enabled: false, cooldownMinutes: 60 }); });
test('notification preferences require an admin session and CSRF for mutation', async () => {
  expect((await request(app).get('/admin/notifications/preferences')).status).toBe(403);
  expect((await request(app).put('/admin/notifications/preferences').set('Cookie', cookies('viewer')).send({ incidentEmailEnabled: true })).status).toBe(403);
  const response = await request(app).put('/admin/notifications/preferences').set('Cookie', cookies('viewer')).set('X-CSRF-Token', csrfToken).send({ incidentEmailEnabled: true });
  expect(response.status).toBe(200);
  expect(Notifications.savePreferences).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'own-account' }), { incidentEmailEnabled: true });
});
test('rule updates are passed only from a CSRF-protected admin route; service owns super-admin authorization', async () => {
  Notifications.saveRule.mockResolvedValue({ key: 'overview_source_unavailable', version: 1, enabled: true, cooldownMinutes: 60 });
  const response = await request(app).put('/admin/notifications/rule').set('Cookie', cookies('super_admin')).set('X-CSRF-Token', csrfToken).send({ version: 0, enabled: true, cooldownMinutes: 60 });
  expect(response.status).toBe(200);
  expect(Notifications.saveRule).toHaveBeenCalledWith(expect.objectContaining({ adminRole: 'super_admin' }), { version: 0, enabled: true, cooldownMinutes: 60 });
});
