jest.mock('../src/models/account.model', () => ({ find: jest.fn() }));
jest.mock('../src/models/adminIncident.model', () => ({ find: jest.fn() }));
jest.mock('../src/models/adminNotificationRule.model', () => ({ findOne: jest.fn(), findOneAndUpdate: jest.fn() }));
jest.mock('../src/models/adminNotificationDelivery.model', () => ({ findOne: jest.fn(), create: jest.fn(), updateOne: jest.fn() }));
jest.mock('../src/services/email.service', () => ({ sendMail: jest.fn() }));
jest.mock('../src/services/auditLog.service', () => ({ execute: jest.fn() }));

const Account = require('../src/models/account.model');
const AdminIncident = require('../src/models/adminIncident.model');
const Rule = require('../src/models/adminNotificationRule.model');
const Delivery = require('../src/models/adminNotificationDelivery.model');
const { sendMail } = require('../src/services/email.service');
const Notifications = require('../src/services/adminNotifications.service');

function lean(value) { return { lean: jest.fn().mockResolvedValue(value) }; }

beforeEach(() => {
  jest.clearAllMocks();
  Delivery.findOne.mockReturnValue(lean(null));
  Delivery.create.mockResolvedValue({ _id: 'delivery-1' });
  Delivery.updateOne.mockResolvedValue({});
  sendMail.mockResolvedValue({ messageId: 'mail-1' });
});

test('rejects malformed minimal rule configuration', () => {
  expect(() => Notifications.validateRule({ version: 0, enabled: true, cooldownMinutes: 4 })).toThrow('Rule configuration is invalid.');
  expect(Notifications.validateRule({ version: 0, enabled: false, cooldownMinutes: 60 })).toEqual({ version: 0, enabled: false, cooldownMinutes: 60 });
});

test('does not resolve recipients or write deliveries while the rule is disabled', async () => {
  Rule.findOne.mockReturnValue(lean({ key: Notifications.RULE_KEY, version: 2, enabled: false, cooldownMinutes: 60 }));
  await Notifications.notifyIncidentEvents([{ incidentId: '507f1f77bcf86cd799439011', eventType: 'detected', _id: 'event-1' }]);
  expect(Account.find).not.toHaveBeenCalled();
  expect(AdminIncident.find).not.toHaveBeenCalled();
  expect(Delivery.create).not.toHaveBeenCalled();
});

test('sends only an opted-in recipient for a directly unavailable source', async () => {
  Rule.findOne.mockReturnValue(lean({ key: Notifications.RULE_KEY, version: 2, enabled: true, cooldownMinutes: 60 }));
  AdminIncident.find.mockReturnValue(lean([{
    _id: '507f1f77bcf86cd799439011', source: { type: 'overview_source', id: 'ringserver' },
    evidence: { retrievalStatus: 'unavailable' }, subsystem: 'Ringserver', title: 'Ringserver evidence unavailable', detail: 'The source failed.', route: '/ringserver', firstDetectedAt: new Date('2026-01-01T00:00:00Z'),
  }]));
  Account.find.mockReturnValue({ select: jest.fn().mockReturnValue(lean([{ _id: 'admin-1', email: 'ops@example.test' }])) });
  await Notifications.notifyIncidentEvents([{ incidentId: '507f1f77bcf86cd799439011', eventType: 'detected', _id: 'event-1' }]);
  expect(Delivery.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending', ruleKey: Notifications.RULE_KEY, recipient: { accountId: 'admin-1', email: 'ops@example.test' } }));
  expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'ops@example.test', subject: expect.stringContaining('Ringserver') }));
  expect(Delivery.updateOne).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }), expect.objectContaining({ $set: expect.objectContaining({ status: 'sent' }) }));
});

test('does not notify a derived incident even if the rule is enabled', async () => {
  Rule.findOne.mockReturnValue(lean({ key: Notifications.RULE_KEY, version: 2, enabled: true, cooldownMinutes: 60 }));
  AdminIncident.find.mockReturnValue(lean([{ _id: '507f1f77bcf86cd799439011', source: { type: 'derived_metric', id: 'stations' }, evidence: { retrievalStatus: 'unavailable' } }]));
  Account.find.mockReturnValue({ select: jest.fn().mockReturnValue(lean([{ _id: 'admin-1', email: 'ops@example.test' }])) });
  await Notifications.notifyIncidentEvents([{ incidentId: '507f1f77bcf86cd799439011', eventType: 'detected', _id: 'event-1' }]);
  expect(Delivery.create).not.toHaveBeenCalled();
  expect(sendMail).not.toHaveBeenCalled();
});


test('rule saves increment the version without conflicting update operators and report conflicts', async () => {
  const Audit = require('../src/services/auditLog.service');
  Audit.execute.mockImplementation((req, metadata, operation) => operation());
  Rule.findOneAndUpdate.mockReturnValue(lean({ version: 1, enabled: true, cooldownMinutes: 15 }));
  const req = { adminRole: 'super_admin' };
  await expect(Notifications.saveRule(req, { version: 0, enabled: true, cooldownMinutes: 15 })).resolves.toMatchObject({ version: 1 });
  const [, update] = Rule.findOneAndUpdate.mock.calls[0];
  expect(update.$setOnInsert).not.toHaveProperty('version');
  Rule.findOneAndUpdate.mockReturnValue({ lean: jest.fn().mockRejectedValue({ code: 11000 }) });
  await expect(Notifications.saveRule(req, { version: 0, enabled: true, cooldownMinutes: 15 })).rejects.toMatchObject({ statusCode: 409 });
  Rule.findOneAndUpdate.mockReturnValue(lean(null));
  await expect(Notifications.saveRule(req, { version: 1, enabled: true, cooldownMinutes: 15 })).rejects.toMatchObject({ statusCode: 409 });
});

test('distinct recurrences deliver once each and replaying an occurrence is deduplicated', async () => {
  Rule.findOne.mockReturnValue(lean({ enabled: true, cooldownMinutes: 5 }));
  AdminIncident.find.mockReturnValue(lean([{ _id: 'incident-1', source: { type: 'overview_source' }, evidence: { retrievalStatus: 'unavailable' }, firstDetectedAt: new Date(), subsystem: 'Ringserver' }]));
  Account.find.mockReturnValue({ select: jest.fn().mockReturnValue(lean([{ _id: 'admin-1', email: 'ops@example.test' }])) });
  const keys = new Set();
  Delivery.create.mockImplementation(async (row) => {
    if (keys.has(row.dedupeKey)) throw Object.assign(new Error('duplicate'), { code: 11000 });
    keys.add(row.dedupeKey);
    return { _id: row.dedupeKey };
  });
  const event = { incidentId: 'incident-1', eventType: 'reopened', _id: 'occurrence-1' };
  await Notifications.notifyIncidentEvents([event]);
  await Notifications.notifyIncidentEvents([event]);
  Delivery.findOne.mockReturnValue(lean({ status: 'sent' }));
  await Notifications.notifyIncidentEvents([{ ...event, _id: 'occurrence-2' }]);
  Delivery.findOne.mockReturnValue(lean(null));
  await Notifications.notifyIncidentEvents([{ ...event, _id: 'occurrence-3' }]);
  expect(sendMail).toHaveBeenCalledTimes(2);
  expect(keys.size).toBe(3);
});
