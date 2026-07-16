const Account = require('../models/account.model');

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
    approvalStatus: approvalStatus(source),
    linkedDeviceCount: Array.isArray(source.devices) ? source.devices.filter(Boolean).length : 0,
    ringserverUrl: source.ringserverUrl || '',
    ringserverPort: source.ringserverPort || null,
    alertPreferences: { rshakeEmailEnabled: Boolean(source.alertPreferences?.rshakeEmailEnabled) },
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
}

async function listAccounts({ approvalStatus: requestedApproval, role, search, limit = 25, offset = 0 } = {}) {
  const query = {};
  if (role) query.roles = role;
  if (requestedApproval === 'pending') {
    query.roles = 'brgy';
    query.isApproved = false;
  }
  if (requestedApproval === 'approved') {
    query.roles = 'brgy';
    query.isApproved = true;
  }
  if (requestedApproval === 'not_required') query.roles = { $ne: 'brgy' };
  if (search) {
    const expression = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = [{ username: expression }, { email: expression }, { ringserverUrl: expression }];
  }

  const [accounts, total] = await Promise.all([
    Account.find(query)
      .sort({ createdAt: -1, username: 1 })
      .skip(offset)
      .limit(limit)
      .select('username email roles isApproved devices ringserverUrl ringserverPort alertPreferences createdAt updatedAt')
      .lean(),
    Account.countDocuments(query),
  ]);
  return { accounts: accounts.map(serializeAccount), total, limit, offset };
}

async function setBrgyApproval(accountId, approved) {
  const account = await Account.findById(accountId).select('username email roles isApproved ringserverUrl ringserverPort devices alertPreferences createdAt updatedAt');
  if (!account) return { notFound: true };
  if (!Array.isArray(account.roles) || !account.roles.includes('brgy')) return { approvalNotApplicable: true };
  account.isApproved = approved;
  await account.save();
  return { account: serializeAccount(account) };
}

module.exports = { approvalStatus, listAccounts, serializeAccount, setBrgyApproval };
