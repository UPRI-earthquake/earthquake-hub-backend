const Joi = require('joi');
const AdminAccountsService = require('../services/adminAccounts.service');
const AuditLogService = require('../services/auditLog.service');
const { responseCodes } = require('./responseCodes');

const listSchema = Joi.object({
  role: Joi.string().valid('citizen', 'sensor', 'brgy', 'admin').optional(),
  approvalStatus: Joi.string().valid('pending', 'approved', 'not_required').optional(),
  search: Joi.string().trim().max(100).allow('').optional(),
  limit: Joi.number().integer().min(1).max(100).default(25),
  offset: Joi.number().integer().min(0).default(0),
});

const approvalSchema = Joi.object({
  accountId: Joi.string().trim().hex().length(24).required(),
  approved: Joi.boolean().required(),
  reason: Joi.string().trim().min(3).max(1000).required(),
});

exports.listAccounts = async (req, res, next) => {
  try {
    const { error, value } = listSchema.validate(req.query, { stripUnknown: true });
    if (error) throw error;
    const result = await AdminAccountsService.listAccounts(value);
    res.status(200).json({
      status: responseCodes.GENERIC_SUCCESS,
      message: 'Accounts retrieved successfully.',
      payload: result.accounts,
      pagination: { total: result.total, limit: result.limit, offset: result.offset },
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
