jest.mock('../src/models/account.model', () => ({ findOne: jest.fn(), findOneAndUpdate: jest.fn() }));
jest.mock('../src/services/auditLog.service', () => ({ execute: jest.fn(async (_req, _event, operation) => operation()) }));
const Account = require('../src/models/account.model');
const Audit = require('../src/services/auditLog.service');
const { validatePreferences, getPreferences, savePreferences } = require('../src/services/adminPreferences.service');
const layout = () => ['map', 'attention', 'events', 'pipeline', 'archive', 'availability'].map((i, index) => ({ i, x: 0, y: index * 24, w: 6, h: 12 }));
const chain = (value) => ({ select: jest.fn(() => ({ lean: jest.fn().mockResolvedValue(value) })) });
beforeEach(() => jest.clearAllMocks());
test('allows bounded known widgets and an explicit reset', () => {
  expect(validatePreferences({ version: 0, dashboardLayout: layout() }).dashboardLayout).toHaveLength(6);
  expect(validatePreferences({ version: 2, dashboardLayout: null })).toEqual({ version: 2, dashboardLayout: null });
});
test('rejects identity injection, unknown widgets, nonintegers and out-of-grid layouts', () => {
  for (const body of [{ version: 0, dashboardLayout: layout(), accountId: 'another-admin' }, { version: 0, dashboardLayout: [] },
    { version: 0, dashboardLayout: layout().map((row) => ({ ...row, w: 13 })) },
    { version: 0, dashboardLayout: layout().map((row) => ({ ...row, x: 1.1 })) },
    { version: 0, dashboardLayout: layout().map((row) => ({ ...row, i: 'unknown' })) }]) {
    expect(() => validatePreferences(body)).toThrow();
  }
});
test('reads only the authenticated active administrator and defaults old accounts', async () => {
  Account.findOne.mockReturnValue(chain({}));
  expect(await getPreferences({ accountId: 'own-id' })).toEqual({ version: 0, dashboardLayout: null });
  expect(Account.findOne).toHaveBeenCalledWith({ _id: 'own-id', roles: 'admin', isActive: { $ne: false } });
  await expect(getPreferences({})).rejects.toMatchObject({ statusCode: 401 });
});
test('audits and saves only own preferences with optimistic concurrency', async () => {
  Account.findOneAndUpdate.mockReturnValue(chain({ adminPreferences: { version: 1, dashboardLayout: layout() } }));
  const result = await savePreferences({ accountId: 'own-id' }, { version: 0, dashboardLayout: layout() });
  expect(result.version).toBe(1);
  expect(Account.findOneAndUpdate.mock.calls[0][0]).toMatchObject({ _id: 'own-id', roles: 'admin', $or: [{ 'adminPreferences.version': 0 }, { 'adminPreferences.version': { $exists: false } }] });
  expect(Audit.execute).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ eventType: 'admin.preferences.update' }), expect.any(Function));
  Account.findOneAndUpdate.mockReturnValue(chain(null));
  await expect(savePreferences({ accountId: 'own-id' }, { version: 1, dashboardLayout: null })).rejects.toMatchObject({ statusCode: 409 });
});
