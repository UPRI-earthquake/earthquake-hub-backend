const Account = require('../models/account.model');
const { effectiveAdminRole } = require('./adminSession.service');

function approvalStatus(account) {
  const roles = Array.isArray(account.roles) ? account.roles : [];
  if (!roles.includes('brgy')) return 'not_required';
  return account.isApproved ? 'approved' : 'pending';
}

function serializeAccount(account) {
  const source = typeof account?.toObject === 'function' ? account.toObject() : account;
  if (!source) return null;
  return {
    accountId: String(source._id),
    username: source.username || '',
    email: source.email || '',
    roles: Array.isArray(source.roles) ? source.roles : [],
    isActive: source.isActive !== false,
    lifecycleStatus: source.isActive === false ? 'inactive' : 'active',
    adminRole: Array.isArray(source.roles) && source.roles.includes('admin')
      ? effectiveAdminRole(source)
      : null,
    approvalStatus: approvalStatus(source),
    linkedDeviceCount: Array.isArray(source.devices) ? source.devices.filter(Boolean).length : 0,
    ringserverUrl: source.ringserverUrl || '',
    ringserverPort: source.ringserverPort || null,
    alertPreferences: { rshakeEmailEnabled: Boolean(source.alertPreferences?.rshakeEmailEnabled) },
    linkedStations: Array.isArray(source.devices)
      ? source.devices.filter(Boolean).slice(0, 50).map((device) => ({
        deviceId: String(device._id || device),
        network: device.network || null,
        station: device.station || null,
        streamId: device.streamId && device.streamId !== 'TO_BE_LINKED'
          ? device.streamId
          : null,
      }))
      : [],
    lastLoginAt: source.lastLoginAt || null,
    lastActivityAt: source.lastActivityAt || null,
    deactivatedAt: source.deactivatedAt || null,
    deactivatedBy: source.deactivatedBy || null,
    deactivationReason: source.deactivationReason || null,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
}

async function getAccountSummary() {
  const [total, pendingBrgy, approvedBrgy, admins, linked, inactive] = await Promise.all([
    Account.countDocuments({}),
    Account.countDocuments({ roles: 'brgy', isApproved: false }),
    Account.countDocuments({ roles: 'brgy', isApproved: true }),
    Account.countDocuments({ roles: 'admin' }),
    Account.countDocuments({ 'devices.0': { $exists: true } }),
    Account.countDocuments({ isActive: false }),
  ]);
  return { total, pendingBrgy, approvedBrgy, admins, linked, inactive };
}

async function listAccounts({
  adminRole,
  approvalStatus: requestedApproval,
  includeSummary = false,
  lifecycleStatus,
  linkedDevice,
  role,
  search,
  limit = 25,
  offset = 0,
} = {}) {
  const query = {};
  if (role) query.roles = role;
  if (adminRole) {
    query.roles = 'admin';
    query.adminRole = adminRole === 'super_admin'
      ? { $in: ['super_admin', null] }
      : adminRole;
  }
  if (lifecycleStatus === 'active') query.isActive = { $ne: false };
  if (lifecycleStatus === 'inactive') query.isActive = false;
  if (requestedApproval === 'pending') {
    query.roles = 'brgy';
    query.isApproved = false;
  }
  if (requestedApproval === 'approved') {
    query.roles = 'brgy';
    query.isApproved = true;
  }
  if (requestedApproval === 'not_required') query.roles = { $ne: 'brgy' };
  if (linkedDevice === 'linked') query['devices.0'] = { $exists: true };
  if (linkedDevice === 'unlinked') query['devices.0'] = { $exists: false };
  if (search) {
    const expression = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = [{ username: expression }, { email: expression }, { ringserverUrl: expression }];
  }

  const [accounts, total, summary] = await Promise.all([
    Account.find(query)
      .sort({ createdAt: -1, username: 1 })
      .skip(offset)
      .limit(limit)
      .select('username email roles adminRole isActive sessionVersion lastLoginAt lastActivityAt deactivatedAt deactivatedBy deactivationReason isApproved devices ringserverUrl ringserverPort alertPreferences createdAt updatedAt')
      .populate('devices', 'network station streamId')
      .lean(),
    Account.countDocuments(query),
    includeSummary ? getAccountSummary() : Promise.resolve(undefined),
  ]);
  return { accounts: accounts.map(serializeAccount), total, limit, offset, summary };
}

async function setBrgyApproval(accountId, approved) {
  const account = await Account.findById(accountId).select('username email roles isApproved ringserverUrl ringserverPort devices alertPreferences createdAt updatedAt');
  if (!account) return { notFound: true };
  if (!Array.isArray(account.roles) || !account.roles.includes('brgy')) return { approvalNotApplicable: true };
  account.isApproved = approved;
  await account.save();
  return { account: serializeAccount(account) };
}

function activeSuperAdminQuery(excludedId) {
  return {
    _id: { $ne: excludedId },
    roles: 'admin',
    isActive: { $ne: false },
    $or: [
      { adminRole: 'super_admin' },
      { adminRole: { $exists: false } },
      { adminRole: null },
    ],
  };
}

async function setAccountLifecycle(accountId, active, req) {
  const account = await Account.findById(accountId)
    .select('username email roles adminRole isActive sessionVersion lastLoginAt lastActivityAt isApproved devices ringserverUrl ringserverPort alertPreferences createdAt updatedAt deactivatedAt deactivatedBy deactivationReason')
    .populate('devices', 'network station streamId');
  if (!account) return { notFound: true };
  if (!active && String(account._id) === String(req.accountId)) return { selfDeactivationBlocked: true };
  if (!active && account.roles?.includes('admin') && effectiveAdminRole(account) === 'super_admin') {
    const anotherActiveSuperAdmin = await Account.exists(activeSuperAdminQuery(account._id));
    if (!anotherActiveSuperAdmin) return { lastSuperAdminBlocked: true };
  }

  if ((account.isActive !== false) === active) return { account: serializeAccount(account), noChange: true };
  account.isActive = active;
  account.sessionVersion = Number(account.sessionVersion || 0) + 1;
  if (active) {
    account.deactivatedAt = undefined;
    account.deactivatedBy = undefined;
    account.deactivationReason = undefined;
  } else {
    account.deactivatedAt = new Date();
    account.deactivatedBy = req.username;
    account.deactivationReason = req.reason;
  }
  await account.save();
  return { account: serializeAccount(account) };
}

async function revokeAccountSessions(accountId) {
  const account = await Account.findByIdAndUpdate(
    accountId,
    { $inc: { sessionVersion: 1 } },
    { new: true },
  )
    .select('username email roles adminRole isActive sessionVersion lastLoginAt lastActivityAt isApproved devices ringserverUrl ringserverPort alertPreferences createdAt updatedAt deactivatedAt deactivatedBy deactivationReason')
    .populate('devices', 'network station streamId');
  return account ? { account: serializeAccount(account) } : { notFound: true };
}

async function setAdminRole(accountId, adminRole, req) {
  const account = await Account.findById(accountId)
    .select('username email roles adminRole isActive sessionVersion lastLoginAt lastActivityAt isApproved devices ringserverUrl ringserverPort alertPreferences createdAt updatedAt deactivatedAt deactivatedBy deactivationReason')
    .populate('devices', 'network station streamId');
  if (!account) return { notFound: true };
  if (!account.roles?.includes('admin')) return { notAdmin: true };
  const currentRole = effectiveAdminRole(account);
  if (String(account._id) === String(req.accountId) && currentRole !== adminRole) {
    return { selfRoleChangeBlocked: true };
  }
  if (currentRole === 'super_admin' && adminRole !== 'super_admin' && account.isActive !== false) {
    const anotherActiveSuperAdmin = await Account.exists(activeSuperAdminQuery(account._id));
    if (!anotherActiveSuperAdmin) return { lastSuperAdminBlocked: true };
  }
  if (currentRole === adminRole && account.adminRole === adminRole) {
    return { account: serializeAccount(account), noChange: true };
  }
  account.adminRole = adminRole;
  account.sessionVersion = Number(account.sessionVersion || 0) + 1;
  await account.save();
  return { account: serializeAccount(account) };
}

module.exports = {
  approvalStatus,
  getAccountSummary,
  listAccounts,
  revokeAccountSessions,
  serializeAccount,
  setAccountLifecycle,
  setAdminRole,
  setBrgyApproval,
};
