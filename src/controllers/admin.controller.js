const Joi = require('joi');
const AccountsService = require('../services/accounts.service');
const AdminAuthAuditService = require('../services/adminAuthAudit.service');
const AdminCapabilitiesService = require('../services/adminCapabilities.service');
const AuditLogService = require('../services/auditLog.service');
const { responseCodes } = require('./responseCodes');
const { clearSessionCookies, setSessionCookies } = require('./helpers');

function toAdminProfile(profile = {}) {
  return {
    username: profile.username,
    email: profile.email,
    roles: profile.roles || [],
    passwordPolicyVersion: profile.passwordPolicyVersion,
    passwordUpdatedAt: profile.passwordUpdatedAt,
    isActive: profile.isActive !== false,
    adminRole: profile.adminRole || 'super_admin',
    sessionVersion: Number(profile.sessionVersion || 0),
    lastLoginAt: profile.lastLoginAt || null,
    lastActivityAt: profile.lastActivityAt || null,
  };
}

exports.authenticateAdmin = async (req, res, next) => {
  const authenticateSchema = Joi.object()
    .keys({
      identifier: Joi.string().trim().min(1).max(254),
      username: Joi.string().trim().min(1).max(254),
      password: Joi.string().min(1).max(256).required().messages({
        'string.min': 'Password is required.',
      }),
    })
    .or('identifier', 'username')
    .messages({
      'object.missing': 'Username or email is required.',
      'any.required': '{#label} is required.',
      'string.empty': '{#label} cannot be empty.',
    });

  try {
    const result = authenticateSchema.validate(req.body, { abortEarly: false });
    if (result.error) throw result.error;

    const identifier = (result.value.identifier || result.value.username || '').trim();
    const loginResult = await AccountsService.loginAccountRole(
      identifier,
      result.value.password,
      'admin',
      { maskUserNotFound: true },
    );
    const returnStr = loginResult?.str || loginResult;

    switch (returnStr) {
      case 'invalidCredentials':
      case 'accountNotExists':
      case 'wrongPassword':
        await AdminAuthAuditService.recordAuthentication(req, {
          identifier,
          outcome: 'rejected',
          reasonCode: 'invalid_credentials',
        });
        res.status(401).json({
          status: responseCodes.AUTHENTICATION_INVALID_CREDENTIALS || responseCodes.AUTHENTICATION_ERROR,
          message: 'Invalid username/email or password.',
        });
        res.message = 'Admin authentication failed.';
        return;
      case 'invalidRole':
        await AdminAuthAuditService.recordAuthentication(req, {
          identifier,
          outcome: 'rejected',
          reasonCode: 'invalid_role',
        });
        res.status(403).json({
          status: responseCodes.AUTHENTICATION_INVALID_ROLE,
          message: 'Admin access is not enabled for this account.',
        });
        res.message = 'Admin role required.';
        return;
      case 'accountInactive':
        await AdminAuthAuditService.recordAuthentication(req, {
          identifier,
          outcome: 'rejected',
          reasonCode: 'account_inactive',
        });
        res.status(403).json({
          status: responseCodes.AUTHENTICATION_ACCOUNT_INACTIVE,
          message: 'This admin account is inactive.',
        });
        res.message = 'Inactive admin account rejected.';
        return;
      case 'successAdmin': {
        await AdminAuthAuditService.recordAuthentication(req, {
          accountId: loginResult.accountId,
          identifier,
          outcome: 'succeeded',
          reasonCode: 'credentials_verified',
          username: loginResult.username,
        });
        const profile = {
          username: loginResult.username,
          email: loginResult.email,
          roles: loginResult.roles,
          passwordPolicyVersion: loginResult.passwordPolicyVersion,
          isActive: true,
          adminRole: loginResult.adminRole || 'super_admin',
          sessionVersion: Number(loginResult.sessionVersion || 0),
          lastLoginAt: loginResult.lastLoginAt || null,
        };
        setSessionCookies(res, {
          accountId: loginResult.accountId,
          username: loginResult.username,
          role: 'admin',
          adminRole: profile.adminRole,
          sessionVersion: profile.sessionVersion,
          authTime: Math.floor(Date.now() / 1000),
        });
        res.status(200).json({
          status: responseCodes.AUTHENTICATION_TOKEN_COOKIE,
          message: 'Authentication successful',
          payload: {
            profile,
            capabilities: AdminCapabilitiesService.getCapabilities(profile.adminRole),
          },
        });
        res.message = 'Admin authentication successful.';
        return;
      }
      default:
        throw Error(`Unhandled return value ${returnStr} from loginAccountRole()`);
    }
  } catch (error) {
    console.error('Admin authentication unsuccessful:', error?.message || error);
    next(error);
  }
};

exports.getAdminProfile = async (req, res, next) => {
  try {
    if (!req.isAuthenticated) {
      const statusCode = req.sessionError === 'invalidRole' ? 403 : 401;
      res.status(statusCode).json({
        status: req.sessionError === 'invalidRole'
          ? responseCodes.VERIFICATION_INVALID_ROLE
          : responseCodes.AUTHENTICATION_SESSION_EXPIRED,
        message: req.sessionError === 'invalidRole'
          ? 'Admin role required.'
          : 'Admin session required.',
      });
      res.message = 'Admin profile rejected.';
      return;
    }

    const outcome = await AccountsService.getAccountProfile(req.username);
    if (outcome.str === 'accountNotExists') {
      clearSessionCookies(res);
      res.status(401).json({
        status: responseCodes.AUTHENTICATION_USER_NOT_EXIST,
        message: 'Admin account no longer exists.',
      });
      res.message = 'Admin account missing.';
      return;
    }

    if (!outcome.profile?.roles?.includes('admin')) {
      res.status(403).json({
        status: responseCodes.VERIFICATION_INVALID_ROLE,
        message: 'Admin role required.',
      });
      res.message = 'Admin role missing from account.';
      return;
    }
    if (outcome.profile.isActive === false) {
      clearSessionCookies(res);
      res.status(403).json({
        status: responseCodes.AUTHENTICATION_ACCOUNT_INACTIVE,
        errorCode: 'ADMIN_ACCOUNT_INACTIVE',
        message: 'This admin account is inactive.',
      });
      res.message = 'Inactive admin account rejected.';
      return;
    }

    const profile = toAdminProfile(outcome.profile);
    setSessionCookies(res, {
      accountId: req.accountId || outcome.profile.accountId,
      username: profile.username,
      role: 'admin',
      adminRole: profile.adminRole,
      sessionVersion: profile.sessionVersion,
      authTime: Number(req.authTime || 0),
    });

    res.status(200).json({
      status: responseCodes.GENERIC_SUCCESS,
      message: 'Admin profile loaded.',
      payload: {
        profile,
        capabilities: AdminCapabilitiesService.getCapabilities(profile.adminRole),
      },
    });
    res.message = 'Admin profile loaded.';
  } catch (error) {
    console.error('Unable to load admin profile:', error?.message || error);
    next(error);
  }
};

exports.signOutAdmin = async (req, res) => {
  if (req.isAuthenticated) {
    try {
      await AuditLogService.record(req, {
        eventType: 'admin.signout',
        outcome: 'succeeded',
        target: {
          type: 'admin_account',
          id: String(req.accountId || req.username),
          label: req.username,
        },
      });
    } catch (error) {
      console.error('Unable to record admin sign out:', error?.message || error);
    }
  }
  clearSessionCookies(res);
  res.status(200).json({
    status: responseCodes.SIGNOUT_SUCCESS,
    message: 'Sign out successful',
  });
  res.message = 'Admin sign out successful.';
};
