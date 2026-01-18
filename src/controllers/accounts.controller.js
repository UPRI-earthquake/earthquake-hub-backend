const Joi = require('joi');
const jwt = require('jsonwebtoken');
const AccountsService = require('../services/accounts.service');
const { responseCodes } = require('./responseCodes');
const {
  generateAccessToken,
  generateRefreshToken,
  passwordSchema,
  usernameSchema,
  setSessionCookies,
  clearSessionCookies,
  getRefreshTokenSecret,
  CURRENT_PASSWORD_POLICY_VERSION,
} = require('./helpers');

exports.registerAccount = async (req, res, next) => {
  // Define validation schema
  const registerSchema = Joi.object({
    role: Joi.string().valid('brgy', 'citizen').required(),
    username: usernameSchema('Username').required(),
    password: passwordSchema('Password')
      .required(),
    confirmPassword: Joi.equal(Joi.ref('password'))
      .required()
      .messages({
        "any.only": "Passwords should match.",
      }),
    ringserverUrl: Joi.string().domain()
      .messages({
        "string.domain": "Please enter a registered domain for your Ringserver URL"
      }),
    ringserverPort: Joi.number().port()
      .messages({
        "number.port": "Please enter a valid TCP port for your Ringserver"
      }),
    email: Joi.string()
      .email({ minDomainSegments: 2, tlds: { allow: true } })
      .required()
      .messages({
        "string.email": "Please enter a valid email address.",
      }),
  }).messages({ // Default message if no custom message is set for the key
    "any.required": "{#label} is required.",
    "string.empty": "{#label} cannot be empty.",
  });

  try {
    // Validate input
    const result = registerSchema.validate(req.body, { abortEarly: false });
    if(result.error){ throw result.error }

    // Perform task
    const returnStr = await AccountsService.createUniqueAccount(
      result.value.role,
      result.value.username,
      result.value.email,
      result.value.password,
      result.value.ringserverUrl,
      result.value.ringserverPort
    )

    // Respond based on returned value
    let message = "";
    switch (returnStr) {
      case "success":
        message = "Succesfully created account"
        res.status(200).json({
          status: responseCodes.REGISTRATION_SUCCESS,
          message: message
        });
        break;
      case "usernameExists":
        message = 'Username already in use'
        res.status(400).json({
          status: responseCodes.REGISTRATION_USERNAME_IN_USE,
          message: message
        });
        break;
      case "emailExists":
        message = 'Email address already in use'
        res.status(400).json({
          status: responseCodes.REGISTRATION_EMAIL_IN_USE,
          message: message
        });
        break;

      case "ringserverUrlExists":
        console.log(`Registration failed: Ringserver Url already exists!`);
        res.status(400).json({
          status: responseCodes.REGISTRATION_RINGSERVER_URL_IN_USE,
          message: 'Ringserver Url already in use'
        });
        break;

      default:
        throw Error(`Unhandled return value ${returnStr} from createUniqueAccount()`)
    }
    res.message = message // used by next middleware

    return ;
  } catch (error) {
    console.error('Registration unsuccessful:', error?.message || error);
    next(error)
  }
}

exports.authenticateAccount = async (req, res, next) => {
  // Define validation schema
  const authenticateSchema = Joi.object()
    .keys({
      identifier: Joi.string().trim().min(1),
      username: Joi.string().trim().min(1),
      password: Joi.string().min(1).max(256).required().messages({
        'string.min': 'Password is required.',
      }),
      role: Joi.string().valid('sensor', 'citizen', 'brgy').required().messages({
        "any.only": "Valid roles are only 'sensor', 'citizen', or 'brgy'.",
      }),
    })
    .or('identifier', 'username')
    .messages({
      'object.missing': 'Username or email is required.',
      'any.required': '{#label} is required.',
      'string.empty': '{#label} cannot be empty.',
    });

  try{
    // Validate input
    const result = authenticateSchema.validate(req.body, {abortEarly: false});
    if(result.error){ throw result.error }

    const identifier = (result.value.identifier || result.value.username || '').trim();

    // Perform task
    const loginResult = await AccountsService.loginAccountRole(
      identifier,
      result.value.password,
      result.value.role,
      { maskUserNotFound: true }
    )
    const returnStr = loginResult?.str || loginResult;
    const authenticatedUsername = loginResult?.username || identifier;

    // Respond based on returned value
    let message = "";
    switch (returnStr) {
      case "invalidCredentials":
      case "accountNotExists":
      case "wrongPassword":
        message = "Invalid username/email or password.";
        res.status(401).json({
          status: responseCodes.AUTHENTICATION_INVALID_CREDENTIALS || responseCodes.AUTHENTICATION_ERROR,
          message: message,
        });
        break;
      case "invalidRole":
        message = 'Invalid role';
        res.status(400).json({
          status: responseCodes.AUTHENTICATION_INVALID_ROLE,
          message: message
        });
        break;
      case "brgyAccountInactive":
        message = 'Account is not yet approved';
        res.status(400).json({
          status: responseCodes.AUTHENTICATION_ACCOUNT_INACTIVE,
          message: message
        });
        break;
      case "successSensorBrgy":
        message = "Authentication successful";
        const origin = req.get('origin');
        const allowedOrigin = process.env.NODE_ENV === 'production'
                              ? 'https://' + process.env.CLIENT_PROD_HOST
                              : 'http://' + process.env.CLIENT_DEV_HOST +":"+ process.env.CLIENT_DEV_PORT;
        
        if (origin === allowedOrigin) { // origin is from web app
          // return access token in http cookie (so it's hidden from browser js)
          setSessionCookies(res, { username: authenticatedUsername, role: 'brgy' });
          res.status(200).json({
            status: responseCodes.AUTHENTICATION_TOKEN_COOKIE,
            message: "Authentication successful",
            username: authenticatedUsername,
            passwordStatus: loginResult?.passwordStatus,
            passwordPolicyVersion: loginResult?.passwordPolicyVersion,
          })
        } else { // origin is not from web app
          res.status(200).json({
            status: responseCodes.AUTHENTICATION_TOKEN_PAYLOAD,
            message: 'Authentication successful',
            username: authenticatedUsername,
            // return access token as part of json payload
            accessToken: generateAccessToken({
              'username': authenticatedUsername,
              'role': result.value.role
            }, result.value.role === 'brgy' ? 'brgy' : 'device'),
            refreshToken: generateRefreshToken({
              'username': authenticatedUsername,
              'role': result.value.role
            }, result.value.role === 'brgy' ? 'brgy' : 'device'),
            passwordStatus: loginResult?.passwordStatus,
            passwordPolicyVersion: loginResult?.passwordPolicyVersion,
          });
        }
        
        break;
      case "successCitizen":
        message = "Authentication successful";
        setSessionCookies(res, { username: authenticatedUsername, role: 'citizen' });
        res.status(200).json({
          status: responseCodes.AUTHENTICATION_TOKEN_COOKIE,
          message: message,
          username: authenticatedUsername,
          passwordStatus: loginResult?.passwordStatus,
          passwordPolicyVersion: loginResult?.passwordPolicyVersion,
        });
        break;
      default:
        throw Error(`Unhandled return value ${returnStr} from loginAccountRole()`)
    }
    res.message = message; // used by next middleware

    return;
  } catch(error) {
    console.error('Authentication unsuccessful:', error?.message || error);
    next(error)
  }
}

exports.requestPasswordReset = async (req, res, next) => {
  const requestSchema = Joi.object().keys({
    email: Joi.string()
      .email({ minDomainSegments: 2, tlds: { allow: true } })
      .required()
      .messages({
        'string.email': 'Please enter a valid email address.',
      }),
  }).messages({
    'any.required': '{#label} is required.',
    'string.empty': '{#label} cannot be empty.',
  });

  try {
    const result = requestSchema.validate(req.body, { abortEarly: false });
    if (result.error) throw result.error;

    const outcome = await AccountsService.createPasswordResetToken(result.value.email);
    if (outcome?.issued && process.env.NODE_ENV !== 'production') {
      console.log(
        `[accounts] Password reset link for ${outcome.email}: ${outcome.resetUrl || outcome.token}`
      );
    }

    return res.status(200).json({
      status: responseCodes.PASSWORD_RESET_REQUESTED,
      message: 'If this email is registered, a reset link or code was sent.',
    });
  } catch (error) {
    console.error('Password reset request failed:', error?.message || error);
    // Still return the generic response to avoid email enumeration
    res.status(200).json({
      status: responseCodes.PASSWORD_RESET_REQUESTED,
      message: 'If this email is registered, a reset link or code was sent.',
    });
    res.message = 'Password reset request accepted';
    if (error?.isJoi) {
      res.message = 'Validation error';
    }
    return;
  }
};

exports.resetPassword = async (req, res, next) => {
  const resetSchema = Joi.object()
    .keys({
      token: Joi.string().required(),
      password: passwordSchema('New password').required(),
      confirmPassword: Joi.equal(Joi.ref('password'))
        .required()
        .messages({
          'any.only': 'Passwords should match.',
        }),
    })
    .messages({
      'any.required': '{#label} is required.',
      'string.empty': '{#label} cannot be empty.',
    });

  try {
    const result = resetSchema.validate(req.body, { abortEarly: false });
    if (result.error) throw result.error;

    const outcome = await AccountsService.applyPasswordReset(
      result.value.token,
      result.value.password
    );

    let message = '';
    switch (outcome.str) {
      case 'invalid':
        message = 'Reset link or code is invalid.';
        res.status(400).json({
          status: responseCodes.PASSWORD_RESET_INVALID,
          message,
        });
        break;
      case 'expired':
        message = 'Reset link or code has expired.';
        res.status(400).json({
          status: responseCodes.PASSWORD_RESET_EXPIRED,
          message,
        });
        break;
      case 'accountNotExists':
        message = 'Account not found.';
        res.status(400).json({
          status: responseCodes.PASSWORD_RESET_USER_MISSING,
          message,
        });
        break;
      case 'invalidPassword':
        message = outcome.message || 'Password did not meet the requirements.';
        res.status(400).json({
          status: responseCodes.VALIDATION_ERROR,
          message,
        });
        break;
      case 'success':
        message = 'Password updated. You may sign in with your new password.';
        res.status(200).json({
          status: responseCodes.PASSWORD_RESET_SUCCESS,
          message,
        });
        break;
      default:
        throw Error(`Unhandled return value ${outcome.str} from applyPasswordReset()`);
    }
    res.message = message;
  } catch (error) {
    console.error('Password reset failed:', error?.message || error);
    next(error);
  }
};

exports.verifySensorToken = async (req, res, next) => {
  // Define validation schema
  const verifySensorTokenSchema = Joi.object().keys({
    token: Joi.string().regex(/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_.+/=]*$/)
      .required()
      .messages({
        "any.required": "Token string is required.",
        "string.empty": "Token string cannot be empty.",
        "string.pattern.base": "Invalid token string format.",
      }),
  });

  try {
    // Validate input
    const result = verifySensorTokenSchema.validate(req.body);
    if(result.error){ throw result.error }

    // Perform Task
    returnObj = await AccountsService.verifySensorToken(result.value.token, req.username)

    // Respond based on returned value
    let message = "";
    switch (returnObj.str) {
      case "JsonWebTokenError":
        message = "Sender token invalid";
        res.status(403).json({
          status: responseCodes.INBEHALF_VERIFICATION_INVALID_TOKEN,
          message: message
        });
        break;
      case "TokenExpiredError":
        message = "Sender token expired";
        res.status(403).json({
          status: responseCodes.INBEHALF_VERIFICATION_EXPIRED_TOKEN,
          message: message
        });
        break;
      case "tokenRoleInvalid":
        message = "Role in token invalid";
        res.status(403).json({
          status: responseCodes.INBEHALF_VERIFICATION_INVALID_ROLE,
          message: message
        });
        break;
      case "brgyNotFound":
        message = 'Internal error';
        res.status(400).json({
          status: responseCodes.INBEHALF_VERIFICATION_ERROR,
          message: message
        });
        break;
      case "sensorIsValid":
        message = 'Sensor is a valid streamer';
        res.status(200).json({
          status: responseCodes.INBEHALF_VERIFICATION_SUCCESS,
          message: message,
          sensorInfo: {
            username: returnObj.sensor.username,
            role: returnObj.sensor.role, 
            streamIds: returnObj.sensor.streamIds,
            tokenExp: returnObj.sensor.tokenExp,
          },
        });
        break;
      default:
        throw Error(`Unhandled return value ${returnObj} from verifySensorToken()`);
    }
    res.message = message; // used by next middleware

    return;
  } catch(error) {
    console.log(`Sensor verification unsuccessful: \n ${error}`);
    next(error)
  }
}

exports.removeDeviceFromBrgy = async (req, res, next) => {
  // Sensor-triggered removal of a device reference from a brgy account
  const schema = Joi.object({
    brgyUsername: Joi.string().required(),
    streamId: Joi.string()
      .regex(/^[A-Z]{2}_[A-Z0-9]{5}_.*\/MSEED$/)
      .required(),
  });

  try {
    if (!req.username) {
      return res.status(403).json({
        status: 403,
        message: 'Username of a logged-in user is required.',
      });
    }

    const { error, value } = schema.validate(req.body);
    if (error) { throw error; }

    const result = await AccountsService.removeSensorDeviceFromBrgy(
      req.username,
      value.brgyUsername,
      value.streamId,
    );

    switch (result.str) {
      case 'success':
        res.status(200).json({
          status: responseCodes.GENERIC_SUCCESS,
          message: 'Device removed from brgy account',
        });
        break;
      case 'deviceNotLinkedToBrgy':
        res.status(200).json({
          status: responseCodes.GENERIC_SUCCESS,
          message: 'Device not linked to specified brgy account; nothing to remove',
        });
        break;
      case 'deviceNotOwnedBySensor':
        res.status(403).json({
          status: responseCodes.GENERIC_ERROR,
          message: 'Device does not belong to requesting sensor',
        });
        break;
      case 'sensorNotFound':
        res.status(400).json({
          status: responseCodes.GENERIC_ERROR,
          message: 'Sensor account not found',
        });
        break;
      case 'brgyNotFound':
        res.status(400).json({
          status: responseCodes.GENERIC_ERROR,
          message: 'Barangay account not found',
        });
        break;
      case 'deviceNotFound':
        res.status(400).json({
          status: responseCodes.GENERIC_ERROR,
          message: 'Device not found',
        });
        break;
      default:
        throw Error(`Unhandled return value ${result} from removeSensorDeviceFromBrgy()`);
    }
  } catch (error) {
    console.log(`Remove device from brgy unsuccessful: \n ${error}`);
    next(error);
  }
};

exports.getAccountProfile = async (req, res, next) => {
  // No validation schema since this is for GET endpoint
  let sessionWasRefreshed = false;
  const allowedSessionRoles = ['citizen', 'brgy'];

  try {
    // Attempt silent refresh if access token is missing/expired but refresh token exists
    if (req.isAuthenticated !== true && req.refreshToken) {
      try {
        const decodedRefresh = jwt.verify(
          req.refreshToken,
          getRefreshTokenSecret('web')
        );

        if (!allowedSessionRoles.includes(decodedRefresh.role)) {
          clearSessionCookies(res);
          return res.status(403).json({
            status: responseCodes.AUTHENTICATION_INVALID_ROLE,
            message: 'Session role not permitted for this route',
          });
        }

        setSessionCookies(res, { username: decodedRefresh.username, role: decodedRefresh.role });
        req.username = decodedRefresh.username;
        req.role = decodedRefresh.role;
        req.isAuthenticated = true;
        sessionWasRefreshed = true;
      } catch (err) {
        clearSessionCookies(res);
        res.status(401).json({
          status: responseCodes.AUTHENTICATION_SESSION_EXPIRED,
          message: 'Session expired. Please sign in again.',
        });
        res.message = 'Session expired';
        return;
      }
    }

    // If optional auth indicates no session or username missing, return soft response
    if (req.isAuthenticated === false || !req.username) {
      if (req.sessionError === 'expired') {
        clearSessionCookies(res);
        res.status(401).json({
          status: responseCodes.AUTHENTICATION_SESSION_EXPIRED,
          message: 'Session expired. Please sign in again.',
        });
        res.message = 'Session expired';
        return;
      }

      if (req.sessionError && req.sessionError !== 'missing') {
        clearSessionCookies(res);
      }

      return res.status(200).json({
        status: responseCodes.GENERIC_SUCCESS,
        message: 'No active session',
      });
    }

    // Perform Task
    let returnObj = await AccountsService.getAccountProfile(req.username)

    // Respond based on returned value
    let message = "";
    switch (returnObj.str) {
      case "accountNotExists":
        message = 'User not found';
        res.status(400).json({
          status: responseCodes.AUTHENTICATION_USER_NOT_EXIST,
          message: message
        });
        break;
      case "success":
        message = sessionWasRefreshed ? 'Session refreshed' : 'Token is valid';
        const passwordStatus =
          (returnObj.profile.passwordPolicyVersion || 0) >= CURRENT_PASSWORD_POLICY_VERSION
            ? 'current'
            : 'legacy';
        res.status(200).json({
          status: sessionWasRefreshed
            ? responseCodes.AUTHENTICATION_SESSION_REFRESHED
            : responseCodes.AUTHENTICATION_SUCCESS,
          message: message, 
          payload: { 
            username: returnObj.profile.username,
            email: returnObj.profile.email,
            roles: returnObj.profile.roles,
            passwordPolicyVersion: returnObj.profile.passwordPolicyVersion,
            passwordUpdatedAt: returnObj.profile.passwordUpdatedAt,
            passwordStatus,
          } 
        });
        break;
      default:
        throw Error(`Unhandled return value ${returnObj} from verifySensorToken()`);
    }
    res.message = message; // used by next middleware

    return;
  } catch (error) {
    console.error('Unable to get account profile:', error?.message || error);
    next(error)
  }
}

exports.updateAccountProfile = async (req, res, next) => {
  const updateSchema = Joi.object()
    .keys({
      email: Joi.string()
        .email({ minDomainSegments: 2, tlds: { allow: true } })
        .messages({
          'string.email': 'Please enter a valid email address.',
        }),
      currentPassword: Joi.string().min(1).max(256),
      newPassword: passwordSchema('New password'),
      confirmPassword: Joi.equal(Joi.ref('newPassword'))
        .messages({
          'any.only': 'Passwords should match.',
        }),
    })
    .messages({
      'string.empty': '{#label} cannot be empty.',
    });

  try {
    const result = updateSchema.validate(req.body, { abortEarly: false });
    if (result.error) throw result.error;

    const { email, newPassword, currentPassword } = result.value;
    if (!email && !newPassword) {
      res.status(400).json({
        status: responseCodes.VALIDATION_ERROR,
        message: 'No account changes supplied.',
      });
      return;
    }
    if (!currentPassword) {
      res.status(401).json({
        status: responseCodes.AUTHENTICATION_ERROR,
        message: 'Current password is required to update your account.',
      });
      return;
    }

    const outcome = await AccountsService.updateAccountProfile(req.username, {
      email,
      newPassword,
      currentPassword,
    });

    switch (outcome.str) {
      case 'accountNotExists':
        res.status(404).json({
          status: responseCodes.AUTHENTICATION_USER_NOT_EXIST,
          message: 'User not found.',
        });
        return;
      case 'wrongPassword':
        res.status(401).json({
          status: responseCodes.AUTHENTICATION_WRONG_PASSWORD,
          message: 'Current password is incorrect.',
        });
        return;
      case 'emailExists':
        res.status(400).json({
          status: responseCodes.REGISTRATION_EMAIL_IN_USE,
          message: 'Email address already in use.',
        });
        return;
      case 'invalidPassword':
        res.status(400).json({
          status: responseCodes.VALIDATION_ERROR,
          message: outcome.message || 'New password did not meet requirements.',
        });
        return;
      case 'noChanges':
        res.status(400).json({
          status: responseCodes.VALIDATION_ERROR,
          message: 'No account changes supplied.',
        });
        return;
      case 'success':
        res.status(200).json({
          status: responseCodes.GENERIC_SUCCESS,
          message: 'Account updated.',
          updated: outcome.updated,
          passwordStatus: outcome.passwordStatus,
          passwordPolicyVersion: outcome.passwordPolicyVersion,
        });
        return;
      default:
        throw Error(`Unhandled return value ${outcome.str} from updateAccountProfile()`);
    }
  } catch (error) {
    console.error('Unable to update account profile:', error?.message || error);
    next(error);
  }
};

exports.updateAccountEmail = async (req, res, next) => {
  const schema = Joi.object()
    .keys({
      email: Joi.string()
        .email({ minDomainSegments: 2, tlds: { allow: true } })
        .required()
        .messages({
          'string.email': 'Please enter a valid email address.',
        }),
      currentPassword: Joi.string().min(1).max(256).required(),
    })
    .messages({
      'any.required': '{#label} is required.',
      'string.empty': '{#label} cannot be empty.',
    });

  try {
    const result = schema.validate(req.body, { abortEarly: false });
    if (result.error) throw result.error;

    const outcome = await AccountsService.updateAccountEmail(req.username, {
      email: result.value.email,
      currentPassword: result.value.currentPassword,
    });

    switch (outcome.str) {
      case 'accountNotExists':
        res.status(404).json({
          status: responseCodes.AUTHENTICATION_USER_NOT_EXIST,
          message: 'User not found.',
        });
        return;
      case 'wrongPassword':
        res.status(401).json({
          status: responseCodes.AUTHENTICATION_WRONG_PASSWORD,
          message: 'Current password is incorrect.',
        });
        return;
      case 'emailExists':
        res.status(400).json({
          status: responseCodes.REGISTRATION_EMAIL_IN_USE,
          message: 'Email address already in use.',
        });
        return;
      case 'noChanges':
        res.status(400).json({
          status: responseCodes.VALIDATION_ERROR,
          message: 'No email change supplied.',
        });
        return;
      case 'success':
        res.status(200).json({
          status: responseCodes.GENERIC_SUCCESS,
          message: 'Email updated.',
          updated: outcome.updated,
        });
        res.message = 'Email updated.';
        return;
      default:
        throw Error(`Unhandled return value ${outcome.str} from updateAccountEmail()`);
    }
  } catch (error) {
    console.error('Unable to update account email:', error?.message || error);
    next(error);
  }
};

exports.updateAccountPassword = async (req, res, next) => {
  const schema = Joi.object()
    .keys({
      currentPassword: Joi.string().min(1).max(256).required(),
      newPassword: passwordSchema('New password').required(),
      confirmPassword: Joi.equal(Joi.ref('newPassword')).required().messages({
        'any.only': 'Passwords should match.',
      }),
    })
    .messages({
      'any.required': '{#label} is required.',
      'string.empty': '{#label} cannot be empty.',
    });

  try {
    const result = schema.validate(req.body, { abortEarly: false });
    if (result.error) throw result.error;

    const outcome = await AccountsService.updateAccountPassword(req.username, {
      currentPassword: result.value.currentPassword,
      newPassword: result.value.newPassword,
    });

    switch (outcome.str) {
      case 'accountNotExists':
        res.status(404).json({
          status: responseCodes.AUTHENTICATION_USER_NOT_EXIST,
          message: 'User not found.',
        });
        return;
      case 'wrongPassword':
        res.status(401).json({
          status: responseCodes.AUTHENTICATION_WRONG_PASSWORD,
          message: 'Current password is incorrect.',
        });
        return;
      case 'invalidPassword':
        res.status(400).json({
          status: responseCodes.VALIDATION_ERROR,
          message: outcome.message || 'New password did not meet requirements.',
        });
        return;
      case 'noChanges':
        res.status(400).json({
          status: responseCodes.VALIDATION_ERROR,
          message: 'No password change supplied.',
        });
        return;
      case 'success':
        res.status(200).json({
          status: responseCodes.GENERIC_SUCCESS,
          message: 'Password updated.',
          updated: outcome.updated,
          passwordStatus: outcome.passwordStatus,
          passwordPolicyVersion: outcome.passwordPolicyVersion,
        });
        res.message = 'Password updated.';
        return;
      default:
        throw Error(`Unhandled return value ${outcome.str} from updateAccountPassword()`);
    }
  } catch (error) {
    console.error('Unable to update account password:', error?.message || error);
    next(error);
  }
};

exports.updateAccountUsername = async (req, res, next) => {
  const schema = Joi.object()
    .keys({
      newUsername: usernameSchema('New username').required(),
      currentPassword: Joi.string().min(1).max(256).required(),
    })
    .messages({
      'any.required': '{#label} is required.',
      'string.empty': '{#label} cannot be empty.',
    });

  try {
    const result = schema.validate(req.body, { abortEarly: false });
    if (result.error) throw result.error;

    const outcome = await AccountsService.updateAccountUsername(req.username, {
      newUsername: result.value.newUsername,
      currentPassword: result.value.currentPassword,
    });

    switch (outcome.str) {
      case 'accountNotExists':
        res.status(404).json({
          status: responseCodes.AUTHENTICATION_USER_NOT_EXIST,
          message: 'User not found.',
        });
        return;
      case 'wrongPassword':
        res.status(401).json({
          status: responseCodes.AUTHENTICATION_WRONG_PASSWORD,
          message: 'Current password is incorrect.',
        });
        return;
      case 'usernameExists':
        res.status(400).json({
          status: responseCodes.REGISTRATION_USERNAME_IN_USE,
          message: 'Username already in use.',
        });
        return;
      case 'invalidUsername':
        res.status(400).json({
          status: responseCodes.VALIDATION_ERROR,
          message: outcome.message || 'Username did not meet requirements.',
        });
        return;
      case 'noChanges':
        res.status(400).json({
          status: responseCodes.VALIDATION_ERROR,
          message: 'No username change supplied.',
        });
        return;
      case 'success':
        setSessionCookies(res, { username: outcome.username, role: req.role });
        res.status(200).json({
          status: responseCodes.GENERIC_SUCCESS,
          message: 'Username updated.',
          payload: { username: outcome.username, updatedDevices: outcome.updatedDevices },
        });
        res.message = 'Username updated.';
        return;
      default:
        throw Error(`Unhandled return value ${outcome.str} from updateAccountUsername()`);
    }
  } catch (error) {
    console.error('Unable to update account username:', error?.message || error);
    next(error);
  }
};

exports.deleteAccount = async (req, res, next) => {
  try {
    const outcome = await AccountsService.deleteAccount(req.username);

    switch (outcome.str) {
      case 'accountNotExists':
        res.status(404).json({
          status: responseCodes.AUTHENTICATION_USER_NOT_EXIST,
          message: 'User not found.',
        });
        return;
      case 'hasDevices':
        res.status(409).json({
          status: responseCodes.ACCOUNT_DELETE_HAS_DEVICES || responseCodes.VALIDATION_ERROR,
          message:
            'All devices must be unlinked and reset via the sender software (rs.local:3000) before deleting this account.',
          deviceCount: outcome.deviceCount,
        });
        res.message = 'Account deletion blocked: devices still linked';
        return;
      case 'success':
        clearSessionCookies(res);
        res.status(200).json({
          status: responseCodes.GENERIC_SUCCESS,
          message: 'Account deleted.',
        });
        res.message = 'Account deleted.';
        return;
      default:
        throw Error(`Unhandled return value ${outcome.str} from deleteAccount()`);
    }
  } catch (error) {
    console.error('Unable to delete account:', error?.message || error);
    next(error);
  }
};

exports.removeCookies = async (req, res, next) => {
  try {
    let message = "Sign out successful"
    clearSessionCookies(res);
    res.json({ 
      status: responseCodes.SIGNOUT_SUCCESS,
      message: message
    });
    res.message = message
  } catch (error) {
    console.error('Error occurred during signout:', error);
    res.status(500).json({ 
      status: responseCodes.SIGNOUT_ERROR,
      message: 'Error occured during signout' 
    });
  }
}

exports.getActiveRingserverHosts = async (req, res, next) => {
  // No validation schema since this is for GET endpoint

  try {
    // Perform Task
    returnObj = await AccountsService.getActiveRingserverHosts()

    // Respond based on returned value
    switch (returnObj.str) {
      case "accountNotExists":
        res.status(400).json({
          status: responseCodes.AUTHENTICATION_USER_NOT_EXIST,
          message: 'User not found'
        });
        break;
      case "success":
        res.status(200).json({ 
          status: responseCodes.GENERIC_SUCCESS,
          message: 'Get active ringserver hosts successful',
          payload: returnObj.hosts
        });
        break;
      default:
        throw Error(`Unhandled return value ${returnObj} from getActiveRingserverHosts()`)
    }
  } catch (error) {
    console.error('Error getting active ringserver hosts:', error);
    next(error)
  }
}

exports.getBrgyToken = async (req, res, next) => {
  // No validation here (token is checked as middleware)

  try {
    // Perform Task
    
    // Respond
    res.status(200).json({
      status: responseCodes.AUTHENTICATION_TOKEN_PAYLOAD,
      message: 'Authentication successful',
      // return access token as part of json payload
      accessToken: generateAccessToken({
        'username': req.username,
        'role': req.role
      }, req.role === 'brgy' ? 'brgy' : 'device'),
      refreshToken: generateRefreshToken({
        'username': req.username,
        'role': req.role
      }, req.role === 'brgy' ? 'brgy' : 'device'),
    });
    
  } catch (error) {
    console.log(`Unable to get brgy token: \n ${error}`);
    next(error)
  }  
}
