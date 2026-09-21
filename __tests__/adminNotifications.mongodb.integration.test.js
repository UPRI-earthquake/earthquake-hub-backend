const mongoose = require('mongoose');
const { GenericContainer, Wait } = require('testcontainers');
jest.mock('../src/services/email.service', () => ({ sendMail: jest.fn().mockResolvedValue({ messageId: 'synthetic-mail' }) }));
const Account = require('../src/models/account.model');
const Incident = require('../src/models/adminIncident.model');
const Rule = require('../src/models/adminNotificationRule.model');
const Delivery = require('../src/models/adminNotificationDelivery.model');
const Notifications = require('../src/services/adminNotifications.service');
const { sendMail } = require('../src/services/email.service');
const describeMongo = process.env.RUN_MONGO_INTEGRATION === '1' ? describe : describe.skip;

describeMongo('Notification persistence in disposable MongoDB', () => {
  let mongo;
  let req;
  beforeAll(async () => {
    mongo = await new GenericContainer('mongo:5.0').withExposedPorts(27017).withWaitStrategy(Wait.forLogMessage(/Waiting for connections/)).withStartupTimeout(120000).start();
    await mongoose.connect(`mongodb://${mongo.getHost()}:${mongo.getMappedPort(27017)}/notification-refinement-test`);
    await Promise.all([Rule.syncIndexes(), Delivery.syncIndexes()]);
    const account = await Account.create({ username: 'fixture-admin', email: 'fixture@example.test', roles: ['admin'], adminRole: 'super_admin' });
    req = { accountId: String(account._id), adminRole: 'super_admin', headers: {}, method: 'PUT', originalUrl: '/api/admin/notifications/rule' };
  }, 150000);
  afterAll(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });

  test('initial save, reload, version conflict, recipient preference and later recurrence', async () => {
    const initial = await Notifications.getRule();
    const rule = await Notifications.saveRule(req, { version: initial.version, enabled: true, cooldownMinutes: 5 });
    expect(rule).toMatchObject({ version: 1, enabled: true });
    expect(await Notifications.getRule()).toEqual(rule);
    await expect(Notifications.saveRule(req, { version: 0, enabled: false, cooldownMinutes: 5 })).rejects.toMatchObject({ statusCode: 409 });
    await expect(Notifications.saveRule({ ...req, adminRole: 'viewer' }, { version: 1, enabled: false, cooldownMinutes: 5 })).rejects.toMatchObject({ statusCode: 403 });
    await Notifications.savePreferences(req, { incidentEmailEnabled: true });
    expect(await Notifications.getPreferences(req)).toEqual({ incidentEmailEnabled: true });
    const id = new mongoose.Types.ObjectId();
    // Use the collection to avoid unrelated incident schema requirements; the notification service reads these exact fields.
    await Incident.collection.insertOne({ _id: id, source: { type: 'overview_source', id: 'ringserver' }, evidence: { retrievalStatus: 'unavailable' }, title: 'Fixture source unavailable', subsystem: 'Ringserver', firstDetectedAt: new Date(), route: '/ringserver' });
    const first = { _id: new mongoose.Types.ObjectId(), incidentId: id, eventType: 'detected' };
    await Notifications.notifyIncidentEvents([first]);
    await Notifications.notifyIncidentEvents([first]);
    const suppressed = { ...first, _id: new mongoose.Types.ObjectId(), eventType: 'reopened' };
    await Notifications.notifyIncidentEvents([suppressed]);
    expect(await Delivery.countDocuments({ status: 'sent' })).toBe(1);
    expect(await Delivery.countDocuments({ status: 'suppressed' })).toBe(1);
    await Delivery.updateMany({ status: 'sent' }, { $set: { completedAt: new Date(Date.now() - 3600000) } });
    await Notifications.notifyIncidentEvents([{ ...suppressed, _id: new mongoose.Types.ObjectId() }]);
    expect(await Delivery.countDocuments({ status: 'sent' })).toBe(2);
    expect(sendMail).toHaveBeenCalledTimes(2);
  });
});
