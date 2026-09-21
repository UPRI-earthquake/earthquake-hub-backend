const Account = require('../models/account.model');
const AdminIncident = require('../models/adminIncident.model');
const AdminNotificationDelivery = require('../models/adminNotificationDelivery.model');
const AdminNotificationRule = require('../models/adminNotificationRule.model');
const AuditLogService = require('./auditLog.service');
const { sendMail } = require('./email.service');

const RULE_KEY = 'overview_source_unavailable';
const DEFAULT_RULE = Object.freeze({ key: RULE_KEY, version: 0, enabled: false, cooldownMinutes: 60 });

function fail(message, statusCode = 400) { throw Object.assign(new Error(message), { statusCode }); }
function plain(value) { return value?.toObject ? value.toObject() : value; }
function serializeRule(rule) {
  const value = plain(rule) || DEFAULT_RULE;
  return { key: RULE_KEY, version: Number(value.version || 0), enabled: value.enabled === true, cooldownMinutes: Number(value.cooldownMinutes || 60) };
}
function validateRule(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some((key) => !['version', 'enabled', 'cooldownMinutes'].includes(key))
    || !Number.isSafeInteger(body.version) || body.version < 0
    || typeof body.enabled !== 'boolean'
    || !Number.isInteger(body.cooldownMinutes) || body.cooldownMinutes < 5 || body.cooldownMinutes > 1440) {
    fail('Rule configuration is invalid.');
  }
  return { version: body.version, enabled: body.enabled, cooldownMinutes: body.cooldownMinutes };
}
function ownAdmin(req) {
  if (!req.accountId) fail('Admin session required.', 401);
  return { _id: req.accountId, roles: 'admin', isActive: { $ne: false } };
}
async function getRule() {
  return serializeRule(await AdminNotificationRule.findOne({ key: RULE_KEY }).lean());
}
async function saveRule(req, body) {
  const input = validateRule(body);
  if (req.adminRole !== 'super_admin') fail('A super administrator is required to change notification rules.', 403);
  return AuditLogService.execute(req, {
    eventType: 'admin.notification_rule.update',
    target: { type: 'admin_notification_rule', id: RULE_KEY, label: RULE_KEY },
    metadata: { expectedVersion: input.version, enabled: input.enabled, cooldownMinutes: input.cooldownMinutes },
  }, async () => {
    const filter = { key: RULE_KEY, $or: [{ version: input.version }, ...(input.version === 0 ? [{ version: { $exists: false } }] : [])] };
    let updated;
    try {
      updated = await AdminNotificationRule.findOneAndUpdate(filter, {
      $set: { enabled: input.enabled, cooldownMinutes: input.cooldownMinutes },
      $setOnInsert: { key: RULE_KEY },
      $inc: { version: 1 },
    }, { upsert: input.version === 0, new: true, runValidators: true }).lean();
    } catch (error) {
      if (error?.code !== 11000) throw error;
      fail('Notification rule changed in another session. Reload before saving again.', 409);
    }
    if (!updated) fail('Notification rule changed in another session. Reload before saving again.', 409);
    return serializeRule(updated);
  });
}
async function getPreferences(req) {
  const account = await Account.findOne(ownAdmin(req)).select('adminNotificationPreferences').lean();
  if (!account) fail('Active admin account required.', 403);
  return { incidentEmailEnabled: account.adminNotificationPreferences?.incidentEmailEnabled === true };
}
async function savePreferences(req, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || typeof body.incidentEmailEnabled !== 'boolean') fail('Notification preferences are invalid.');
  return AuditLogService.execute(req, {
    eventType: 'admin.notification_preferences.update',
    target: { type: 'admin_account', id: String(req.accountId) },
    metadata: { channel: 'email', incidentEmailEnabled: body.incidentEmailEnabled },
  }, async () => {
    const account = await Account.findOneAndUpdate(ownAdmin(req), { $set: { adminNotificationPreferences: { incidentEmailEnabled: body.incidentEmailEnabled, updatedAt: new Date() } } }, { new: true, runValidators: true }).lean();
    if (!account) fail('Active admin account required.', 403);
    return { incidentEmailEnabled: account.adminNotificationPreferences?.incidentEmailEnabled === true };
  });
}
async function listDeliveries({ limit = 50, offset = 0 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const [deliveries, total] = await Promise.all([
    AdminNotificationDelivery.find({}).sort({ createdAt: -1, _id: -1 }).skip(safeOffset).limit(safeLimit).lean(),
    AdminNotificationDelivery.countDocuments({}),
  ]);
  return { deliveries: deliveries.map((row) => ({
    deliveryId: String(row._id), ruleKey: row.ruleKey, incidentId: String(row.incidentId), incidentEventType: row.incidentEventType,
    recipient: row.recipient, status: row.status, condition: row.condition, attemptedAt: row.attemptedAt, completedAt: row.completedAt || null,
    errorCode: row.errorCode || null, errorMessage: row.errorMessage || null,
  })), total, limit: safeLimit, offset: safeOffset };
}
function isEligibleIncident(incident) {
  return incident?.source?.type === 'overview_source'
    && incident?.evidence?.retrievalStatus === 'unavailable';
}
async function recordSuppressed(base, reason) {
  return AdminNotificationDelivery.create({ ...base, status: 'suppressed', completedAt: new Date(), errorCode: reason });
}
async function notifyOne({ rule, incident, event, recipient }) {
  const accountId = String(recipient._id);
  const base = {
    ruleKey: RULE_KEY,
    incidentId: incident._id,
    incidentEventType: event.eventType,
    recipient: { accountId, email: recipient.email },
    dedupeKey: `${RULE_KEY}:${String(incident._id)}:${String(event._id)}:${accountId}`,
    condition: { sourceId: incident.source?.id || null, title: incident.title, route: incident.route },
  };
  const since = new Date(Date.now() - rule.cooldownMinutes * 60 * 1000);
  const recent = await AdminNotificationDelivery.findOne({ ruleKey: RULE_KEY, incidentId: incident._id, 'recipient.accountId': accountId, status: 'sent', completedAt: { $gte: since } }).lean();
  if (recent) return recordSuppressed(base, 'cooldown_active');
  let delivery;
  try {
    delivery = await AdminNotificationDelivery.create({ ...base, status: 'pending' });
  } catch (error) {
    if (error?.code === 11000) return null;
    throw error;
  }
  try {
    const info = await sendMail({
      to: recipient.email,
      subject: `[UPRI EarthquakeHub] ${incident.subsystem} evidence unavailable`,
      layout: {
        eyebrow: 'Admin operational notification', badge: 'Evidence unavailable',
        title: incident.title, lead: incident.detail,
        details: [
          { label: 'Subsystem', value: incident.subsystem },
          { label: 'Source', value: incident.source?.id || 'Unavailable' },
          { label: 'Detected at', value: new Date(event.createdAt || incident.firstDetectedAt).toISOString() },
          { label: 'Evidence state', value: 'Observed retrieval failure' },
        ],
        ctaLabel: 'Open Admin Console', ctaUrl: incident.route ? `${process.env.ADMIN_CONSOLE_URL || ''}${incident.route}` : '',
      },
    });
    await AdminNotificationDelivery.updateOne({ _id: delivery._id, status: 'pending' }, { $set: { status: 'sent', completedAt: new Date(), providerMessageId: String(info?.messageId || '') || undefined } });
  } catch (error) {
    await AdminNotificationDelivery.updateOne({ _id: delivery._id, status: 'pending' }, { $set: { status: 'failed', completedAt: new Date(), errorCode: String(error?.code || error?.name || 'delivery_failed').slice(0, 128), errorMessage: String(error?.message || 'Email delivery failed.').slice(0, 1000) } });
  }
  return delivery;
}
async function notifyIncidentEvents(events = []) {
  const candidates = events.filter((event) => event._id && ['detected', 'reopened'].includes(event.eventType));
  if (!candidates.length) return;
  const rule = await getRule();
  if (!rule.enabled) return;
  const ids = [...new Set(candidates.map((event) => String(event.incidentId)))];
  const [incidents, recipients] = await Promise.all([
    AdminIncident.find({ _id: { $in: ids } }).lean(),
    Account.find({ roles: 'admin', isActive: { $ne: false }, 'adminNotificationPreferences.incidentEmailEnabled': true, email: { $type: 'string', $ne: '' } }).select('_id email').lean(),
  ]);
  const incidentsById = new Map(incidents.map((incident) => [String(incident._id), incident]));
  await Promise.allSettled(candidates.flatMap((event) => {
    const incident = incidentsById.get(String(event.incidentId));
    if (!isEligibleIncident(incident)) return [];
    return recipients.map((recipient) => notifyOne({ rule, incident, event, recipient }));
  }));
}
module.exports = { RULE_KEY, getRule, saveRule, getPreferences, savePreferences, listDeliveries, notifyIncidentEvents, validateRule };
