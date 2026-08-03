const Account = require('../models/account.model');

const ACTIVITY_WRITE_INTERVAL_MS = 5 * 60 * 1000;

function effectiveAdminRole(account = {}) {
  return ['viewer', 'operator', 'super_admin'].includes(account.adminRole)
    ? account.adminRole
    : 'super_admin';
}

async function validateAccountSession(decodedToken = {}, { allowLegacyGeneration = false } = {}) {
  const selector = decodedToken.accountId
    ? { _id: decodedToken.accountId }
    : { username: decodedToken.username };
  const account = await Account.findOne(selector)
    .select('username roles isActive isApproved sessionVersion adminRole lastActivityAt')
    .lean();
  if (!account) return { valid: false, reason: 'account_missing' };
  const role = decodedToken.role;
  if (!role || !Array.isArray(account.roles) || !account.roles.includes(role)) {
    return { valid: false, reason: role === 'admin' ? 'admin_role_removed' : 'role_removed' };
  }
  if (account.isActive === false) return { valid: false, reason: 'account_inactive' };
  if (role === 'brgy' && account.isApproved === false) {
    return { valid: false, reason: 'account_unapproved' };
  }

  const currentSessionVersion = Number(account.sessionVersion || 0);
  if (
    decodedToken.sessionVersion === undefined
      ? (!allowLegacyGeneration || currentSessionVersion !== 0)
      : Number(decodedToken.sessionVersion) !== currentSessionVersion
  ) {
    return { valid: false, reason: 'session_revoked' };
  }

  const lastActivityAt = account.lastActivityAt ? new Date(account.lastActivityAt).getTime() : 0;
  if (!lastActivityAt || Date.now() - lastActivityAt >= ACTIVITY_WRITE_INTERVAL_MS) {
    await Account.updateOne(
      { _id: account._id },
      { $set: { lastActivityAt: new Date() } },
    );
  }

  return {
    valid: true,
    accountId: String(account._id),
    username: account.username,
    role,
    adminRole: role === 'admin' ? effectiveAdminRole(account) : undefined,
    sessionVersion: currentSessionVersion,
  };
}

async function validateAdminSession(decodedToken = {}) {
  return validateAccountSession({ ...decodedToken, role: 'admin' });
}

module.exports = {
  ACTIVITY_WRITE_INTERVAL_MS,
  effectiveAdminRole,
  validateAccountSession,
  validateAdminSession,
};
