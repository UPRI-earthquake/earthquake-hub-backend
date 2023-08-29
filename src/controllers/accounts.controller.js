const Joi = require('joi');
const AccountsService = require('../services/accounts.service');
const {responseCodes} = require('./responseCodes')
const {generateAccessToken} = require('./helpers')

exports.registerAccount = async (req, res, next) => {
  // Define validation schema
  const registerSchema = Joi.object({
    role: Joi.string().valid('brgy', 'citizen').required(),
    username: Joi.string().required(),
    password: Joi.string()
      .pattern(new RegExp("^[a-zA-Z0-9]{6,30}$"))
      .required()
      .messages({
        "string.pattern.base": "Password must be between 6 and 30 letters and/or digits.",
      }),
    confirmPassword: Joi.equal(Joi.ref("password"))
      .required()
      .messages({
        "any.only": "Passwords should match.",
      }),
    ringserverUrl: Joi.string().domain()
      .messages({
        "string.domain": "Please enter a registered domain for your Ringserver URL"
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
    const result = registerSchema.validate(req.body, {aborEarly: false});
    if(result.error){ throw result.error }

    // Perform task
    returnStr = await AccountsService.createUniqueAccount(
      result.value.role,
      result.value.username,
      result.value.email,
      result.value.password,
      result.value.ringserverUrl
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
    console.log(`Registration unsuccessful: \n ${error}`);
    next(error)
  }
}

exports.authenticateAccount = async (req, res, next) => {
  // Define validation schema
  const authenticateSchema = Joi.object().keys({
    username: Joi.string().required(),
    password: Joi.string()
      .pattern(new RegExp("^[a-zA-Z0-9]{6,30}$"))
      .required()
      .messages({
        "string.pattern.base": "Password must be between 6 and 30 letters and/or digits.",
      }),
    role: Joi.string().valid('sensor', 'citizen', 'brgy').required()
      .messages({
        "any.only": "Valid roles are only 'sensor', 'citizen', or 'brgy'.",
      }),
  }).messages({ // Default message if no custom message is set for the key
    "any.required": "{#label} is required.",
    "string.empty": "{#label} cannot be empty.",
  });

  try{
    // Validate input
    const result = authenticateSchema.validate(req.body, {abortEarly: false});
    if(result.error){ throw result.error }

    // Perform task
    returnStr = await AccountsService.loginAccountRole(
      result.value.username,
      result.value.password,
      result.value.role
    )

    // Respond based on returned value
    let message = "";
    switch (returnStr) {
      case "accountNotExists":
        message = "User doesn't exists!";
        res.status(400).json({
          status: responseCodes.AUTHENTICATION_USER_NOT_EXIST,
          message: message
        });
        break;
      case "wrongPassword":
        message = 'Wrong password';
        res.status(401).json({
          status: responseCodes.AUTHENTICATION_WRONG_PASSWORD,
          message: message
        });
        break;
      case "invalidRole":
        message = 'Invalid role';
        res.status(400).json({
          status: responseCodes.AUTHENTICATION_INVALID_ROLE,
          message: message
        });
        break;
      case "noLinkedDevice":
        message = 'User has no linked device';
        res.status(400).json({
          status: responseCodes.AUTHENTICATION_NO_LINKED_DEVICE,
          message: message
        });
        break;
      case "brgyAccountInactive":
        res.status(400).json({
          status: responseCodes.AUTHENTICATION_ACCOUNT_INACTIVE,
          message: 'Account is not yet approved'
        });
        break;
      case "successSensorBrgy":
        const origin = req.get('origin');
        const allowedOrigin = process.env.NODE_ENV === 'production'
                              ? 'https://' + process.env.CLIENT_PROD_HOST
                              : 'http://' + process.env.CLIENT_DEV_HOST +":"+ process.env.CLIENT_DEV_PORT;
        
        if (origin === allowedOrigin) { // origin is from web app
          res.status(200)
          // return access token in http cookie (so it's hidden from browser js)
          .cookie(
            "accessToken",
            generateAccessToken({'username': result.value.username, 'role': 'brgy'}),
            {
              httpOnly: true, // set to be accessible only by web browser
              secure: process.env.NODE_ENV === "production", // if cookie is for HTTPS only
            }
          )
          .json({
            status: responseCodes.AUTHENTICATION_TOKEN_COOKIE,
            message: "Authentication successful"
          })
        } else { // origin is not from web app
          res.status(200).json({
            status: responseCodes.AUTHENTICATION_TOKEN_PAYLOAD,
            message: 'Authentication successful',
            // return access token as part of json payload
            accessToken: generateAccessToken({
              'username': result.value.username,
              'role': result.value.role
            }),
          });
        }
        
        break;
      case "successCitizen":
        message = "Authentication successful";
        res.status(200)
          // return access token in http cookie (so it's hidden from browser js)
          .cookie(
            "accessToken",
            generateAccessToken({'username': result.value.username, 'role': 'citizen'}),
            {
              httpOnly: true, // set to be accessible only by web browser
              secure: process.env.NODE_ENV === "production", // if cookie is for HTTPS only
            }
          )
          .json({
            status: responseCodes.AUTHENTICATION_TOKEN_COOKIE,
            message: message
          });
        break;
      default:
        throw Error(`Unhandled return value ${returnStr} from loginAccountRole()`)
    }
    res.message = message; // used by next middleware

    return;
  } catch(error) {
    console.log(`Authentication unsuccessful: \n ${error}`);
    next(error)
  }
}

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
            tokenExp: returnObj.sensor.exp,
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

exports.getAccountProfile = async (req, res, next) => {
  // No validation schema since this is for GET endpoint

  try {
    // Perform Task
    returnObj = await AccountsService.getAccountProfile(req.username)

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
        message = 'Token is valid';
        res.status(200).json({
          status: responseCodes.AUTHENTICATION_SUCCESS,
          message: message, 
          payload: { 
            username: returnObj.profile.username,
            email: returnObj.profile.email
          } 
        });
        break;
      default:
        throw Error(`Unhandled return value ${returnObj} from verifySensorToken()`);
    }
    res.message = message; // used by next middleware

    return;
  } catch (error) {
    console.log(`Unable to get account profile: \n ${error}`);
    next(error)
  }
}

exports.removeCookies = async (req, res, next) => {
  try {
    let message = "Sign out successful"
    res.clearCookie('accessToken').json({ 
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
  console.log("List of ringserver hosts requested");

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
      }),
    });
    
  } catch (error) {
    console.log(`Unable to get brgy token: \n ${error}`);
    next(error)
  }  
}

