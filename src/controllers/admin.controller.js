const Joi = require('joi');
const AccountsService = require('../services/accounts.service');
const { responseCodes } = require('./responseCodes');
const { clearSessionCookies, setSessionCookies } = require('./helpers');

function toAdminProfile(profile = {}) {
  return {
    username: profile.username,
    email: profile.email,
    roles: profile.roles || [],
    passwordPolicyVersion: profile.passwordPolicyVersion,
    passwordUpdatedAt: profile.passwordUpdatedAt,
  };
}

exports.authenticateAdmin = async (req, res, next) => {
  const authenticateSchema = Joi.object()
    .keys({
      identifier: Joi.string().trim().min(1),
      username: Joi.string().trim().min(1),
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
        res.status(401).json({
          status: responseCodes.AUTHENTICATION_INVALID_CREDENTIALS || responseCodes.AUTHENTICATION_ERROR,
          message: 'Invalid username/email or password.',
        });
        res.message = 'Admin authentication failed.';
        return;
      case 'invalidRole':
        res.status(403).json({
          status: responseCodes.AUTHENTICATION_INVALID_ROLE,
          message: 'Admin access is not enabled for this account.',
        });
        res.message = 'Admin role required.';
        return;
      case 'successAdmin': {
        const profile = {
          username: loginResult.username,
          email: loginResult.email,
          roles: loginResult.roles,
          passwordPolicyVersion: loginResult.passwordPolicyVersion,
        };
        setSessionCookies(res, {
          accountId: loginResult.accountId,
          username: loginResult.username,
          role: 'admin',
        });
        res.status(200).json({
          status: responseCodes.AUTHENTICATION_TOKEN_COOKIE,
          message: 'Authentication successful',
          payload: { profile },
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

    res.status(200).json({
      status: responseCodes.GENERIC_SUCCESS,
      message: 'Admin profile loaded.',
      payload: {
        profile: toAdminProfile(outcome.profile),
      },
    });
    res.message = 'Admin profile loaded.';
  } catch (error) {
    console.error('Unable to load admin profile:', error?.message || error);
    next(error);
  }
};

exports.signOutAdmin = async (req, res) => {
  clearSessionCookies(res);
  res.status(200).json({
    status: responseCodes.SIGNOUT_SUCCESS,
    message: 'Sign out successful',
  });
  res.message = 'Admin sign out successful.';
};
