const Account = require('../models/account.model');
const AuditLogService = require('./auditLog.service');
const WIDGETS = new Set(['map', 'attention', 'events', 'pipeline', 'archive', 'availability']);
function fail(message, statusCode = 400) { throw Object.assign(new Error(message), { statusCode }); }
function validatePreferences(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some((key) => !['version', 'dashboardLayout'].includes(key))
    || !Number.isSafeInteger(input.version) || input.version < 0 || input.version >= Number.MAX_SAFE_INTEGER) fail('Invalid preference version or fields.');
  if (input.dashboardLayout === null) return { version: input.version, dashboardLayout: null };
  if (!Array.isArray(input.dashboardLayout) || input.dashboardLayout.length !== WIDGETS.size) fail('Dashboard layout must contain every supported widget.');
  const seen = new Set();
  const dashboardLayout = input.dashboardLayout.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).some((key) => !['i', 'x', 'y', 'w', 'h'].includes(key))
      || !WIDGETS.has(row.i) || seen.has(row.i) || !['x', 'y', 'w', 'h'].every((key) => Number.isInteger(row[key]))
      || row.x < 0 || row.w < 4 || row.w > 12 || row.x + row.w > 12 || row.y < 0 || row.y > 144
      || row.h < 6 || row.h > 24 || row.y + row.h > 168) fail('Invalid dashboard widget position or size.');
    seen.add(row.i);
    return { i: row.i, x: row.x, y: row.y, w: row.w, h: row.h };
  });
  return { version: input.version, dashboardLayout };
}
function ownAccount(req) {
  if (!req.accountId) fail('Admin session required.', 401);
  return { _id: req.accountId, roles: 'admin', isActive: { $ne: false } };
}
async function getPreferences(req) {
  const account = await Account.findOne(ownAccount(req)).select('+adminPreferences').lean();
  if (!account) fail('Active admin account required.', 403);
  return { version: account.adminPreferences?.version || 0, dashboardLayout: account.adminPreferences?.dashboardLayout || null };
}
async function savePreferences(req, body) {
  const input = validatePreferences(body);
  const filter = ownAccount(req);
  filter.$or = [{ 'adminPreferences.version': input.version }, ...(input.version === 0 ? [{ 'adminPreferences.version': { $exists: false } }] : [])];
  return AuditLogService.execute(req, {
    eventType: 'admin.preferences.update', target: { type: 'admin_account', id: String(req.accountId) }, metadata: { section: 'dashboard', expectedVersion: input.version },
  }, async () => {
    const updated = await Account.findOneAndUpdate(filter, { $set: { adminPreferences: { version: input.version + 1, dashboardLayout: input.dashboardLayout } } }, { new: true, runValidators: true }).select('+adminPreferences').lean();
    if (!updated) fail('Preferences changed in another session. Reload before saving again.', 409);
    return { version: updated.adminPreferences.version, dashboardLayout: updated.adminPreferences.dashboardLayout || null };
  });
}
module.exports = { validatePreferences, getPreferences, savePreferences };
