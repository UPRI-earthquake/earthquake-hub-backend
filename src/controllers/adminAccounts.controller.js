const Joi = require('joi');
const AdminAccountsService = require('../services/adminAccounts.service');
const AuditLogService = require('../services/auditLog.service');
const { responseCodes } = require('./responseCodes');

const listSchema = Joi.object({
  role: Joi.string().valid('citizen', 'sensor', 'brgy', 'admin').optional(),
  adminRole: Joi.string().valid('viewer', 'operator', 'super_admin').optional(),
  lifecycleStatus: Joi.string().valid('active', 'inactive').optional(),
  approvalStatus: Joi.string().valid('pending', 'approved', 'not_required').optional(),
  linkedDevice: Joi.string().valid('linked', 'unlinked').optional(),
  search: Joi.string().trim().max(100).allow('').optional(),
  limit: Joi.number().integer().min(1).max(100).default(25),
  offset: Joi.number().integer().min(0).default(0),
});

const approvalSchema = Joi.object({
  accountId: Joi.string().trim().hex().length(24).required(),
  approved: Joi.boolean().required(),
  reason: Joi.string().trim().min(3).max(1000).required(),
});
const lifecycleSchema = Joi.object({
  accountId: Joi.string().trim().hex().length(24).required(),
  active: Joi.boolean().required(),
  confirmation: Joi.string().trim().required(),
  reason: Joi.string().trim().min(3).max(1000).required(),
});
const sessionRevocationSchema = Joi.object({
  accountId: Joi.string().trim().hex().length(24).required(),
  reason: Joi.string().trim().min(3).max(1000).required(),
});
const adminRoleSchema = Joi.object({
  accountId: Joi.string().trim().hex().length(24).required(),
  adminRole: Joi.string().valid('viewer', 'operator', 'super_admin').required(),
  confirmation: Joi.string().trim().required(),
  reason: Joi.string().trim().min(3).max(1000).required(),
});

function accountOperationError(result) {
  if (result.notFound) {
    return Object.assign(new Error('Account not found.'), {
      code: 'ADMIN_ACCOUNT_NOT_FOUND',
      statusCode: 404,
    });
  }
  if (result.selfDeactivationBlocked) {
    return Object.assign(new Error('You cannot deactivate your own admin account.'), {
      code: 'ADMIN_SELF_DEACTIVATION_BLOCKED',
      statusCode: 409,
    });
  }
  if (result.selfRoleChangeBlocked) {
    return Object.assign(new Error('You cannot change your own admin privilege tier.'), {
      code: 'ADMIN_SELF_ROLE_CHANGE_BLOCKED',
      statusCode: 409,
    });
  }
  if (result.lastSuperAdminBlocked) {
    return Object.assign(new Error('At least one active super-admin account must remain.'), {
      code: 'ADMIN_LAST_SUPER_ADMIN_REQUIRED',
      statusCode: 409,
    });
  }
  if (result.notAdmin) {
    return Object.assign(new Error('Admin privilege tiers apply only to admin accounts.'), {
      code: 'ADMIN_ROLE_NOT_APPLICABLE',
      statusCode: 409,
    });
  }
  return null;
}

function sendKnownAccountError(res, error) {
  if (!error?.code?.startsWith('ADMIN_')) return false;
  res.status(error.statusCode || 409).json({
    status: responseCodes.GENERIC_ERROR,
    errorCode: error.code,
    retryable: false,
    message: error.message,
  });
  return true;
}

exports.listAccounts = async (req, res, next) => {
  try {
    const { error, value } = listSchema.validate(req.query, { stripUnknown: true });
    if (error) throw error;
    const result = await AdminAccountsService.listAccounts({ ...value, includeSummary: true });
    res.status(200).json({
      status: responseCodes.GENERIC_SUCCESS,
      message: 'Accounts retrieved successfully.',
      payload: result.accounts,
      pagination: { total: result.total, limit: result.limit, offset: result.offset },
      summary: result.summary,
    });
    res.message = 'Accounts retrieved successfully.';
  } catch (error) { next(error); }
};

exports.setBrgyApproval = async (req, res, next) => {
  try {
    const { error, value } = approvalSchema.validate({ ...req.params, ...req.body }, { stripUnknown: true });
    if (error) throw error;
    const eventType = value.approved ? 'account.brgy.approve' : 'account.brgy.revoke_approval';
    const result = await AuditLogService.execute(req, {
      eventType,
      target: { type: 'account', id: value.accountId, label: value.accountId },
      reason: value.reason,
    }, () => AdminAccountsService.setBrgyApproval(value.accountId, value.approved));
    if (result.notFound) return res.status(404).json({ status: responseCodes.GENERIC_ERROR, message: 'Account not found.' });
    if (result.approvalNotApplicable) return res.status(409).json({ status: responseCodes.GENERIC_ERROR, message: 'Approval is only applicable to brgy accounts.' });
    res.status(200).json({ status: responseCodes.GENERIC_SUCCESS, message: value.approved ? 'Brgy account approved successfully.' : 'Brgy account approval revoked successfully.', payload: result.account });
    res.message = value.approved ? 'Brgy account approved successfully.' : 'Brgy account approval revoked successfully.';
  } catch (error) { next(error); }
};

exports.setAccountLifecycle = async (req, res, next) => {
  try {
    const { error, value } = lifecycleSchema.validate(
      { ...req.params, ...req.body },
      { stripUnknown: true },
    );
    if (error) throw error;
    const result = await AuditLogService.execute(req, {
      eventType: value.active ? 'account.lifecycle.activate' : 'account.lifecycle.deactivate',
      target: { type: 'account', id: value.accountId, label: value.accountId },
      reason: value.reason,
    }, async () => {
      const outcome = await AdminAccountsService.setAccountLifecycle(
        value.accountId,
        value.active,
        { accountId: req.accountId, username: req.username, reason: value.reason },
      );
      const operationError = accountOperationError(outcome);
      if (operationError) throw operationError;
      return outcome;
    });
    res.status(200).json({
      status: responseCodes.GENERIC_SUCCESS,
      message: value.active
        ? 'Account activated and prior sessions revoked.'
        : 'Account deactivated and prior sessions revoked.',
      payload: result.account,
    });
    res.message = value.active ? 'Account activated.' : 'Account deactivated.';
  } catch (error) {
    if (!sendKnownAccountError(res, error)) next(error);
  }
};

exports.revokeAccountSessions = async (req, res, next) => {
  try {
    const { error, value } = sessionRevocationSchema.validate(
      { ...req.params, ...req.body },
      { stripUnknown: true },
    );
    if (error) throw error;
    const result = await AuditLogService.execute(req, {
      eventType: 'account.sessions.revoke',
      target: { type: 'account', id: value.accountId, label: value.accountId },
      reason: value.reason,
    }, async () => {
      const outcome = await AdminAccountsService.revokeAccountSessions(value.accountId);
      const operationError = accountOperationError(outcome);
      if (operationError) throw operationError;
      return outcome;
    });
    res.status(200).json({
      status: responseCodes.GENERIC_SUCCESS,
      message: 'Generation-bound sessions for this account were revoked.',
      payload: result.account,
    });
    res.message = 'Account sessions revoked.';
  } catch (error) {
    if (!sendKnownAccountError(res, error)) next(error);
  }
};

exports.setAdminRole = async (req, res, next) => {
  try {
    const { error, value } = adminRoleSchema.validate(
      { ...req.params, ...req.body },
      { stripUnknown: true },
    );
    if (error) throw error;
    const result = await AuditLogService.execute(req, {
      eventType: 'account.admin_role.update',
      target: { type: 'account', id: value.accountId, label: value.accountId },
      reason: value.reason,
      metadata: { requestedAdminRole: value.adminRole },
    }, async () => {
      const outcome = await AdminAccountsService.setAdminRole(
        value.accountId,
        value.adminRole,
        req,
      );
      const operationError = accountOperationError(outcome);
      if (operationError) throw operationError;
      return outcome;
    });
    res.status(200).json({
      status: responseCodes.GENERIC_SUCCESS,
      message: 'Admin privilege tier updated and prior sessions revoked.',
      payload: result.account,
    });
    res.message = 'Admin privilege tier updated.';
  } catch (error) {
    if (!sendKnownAccountError(res, error)) next(error);
  }
};
