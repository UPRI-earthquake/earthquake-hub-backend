const Joi = require('joi');
const jwt = require('jsonwebtoken');
const AccountsService = require('../services/accounts.service');
const {responseCodes} = require('./responseCodes')

exports.registerAccount = async (req, res, next) => {
  console.log("Register account requested");

  // Define validation schema
  const registerSchema = Joi.object({
    role: Joi.string().valid('brgy', 'citizen').required(),
    username: Joi.string().required(),
    password: Joi.string().pattern(new RegExp('^[a-zA-Z0-9]{6,30}$')).required(),
    confirmPassword: Joi.equal(Joi.ref('password')).required()
                     .messages({"any.only": "Passwords should match."}),
    email: Joi.string().email({ minDomainSegments: 2, tlds: { allow: ['com', 'net'] } }).required(), 
    ringserverUrl: Joi.string()
  });

  try {
    // Validate input
    const result = registerSchema.validate(req.body);
    if(result.error){
      console.log(result.error.details[0].message)
      res.status(400).json({
        status: responseCodes.REGISTRATION_ERROR, 
        message: result.error.details[0].message
      });
      return;
    }

    // Perform task
    returnStr = await AccountsService.createUniqueAccount(
      result.value.role,
      result.value.username,
      result.value.email,
      result.value.password,
      result.value.ringserverUrl
    )

    // Respond based on returned value
    switch (returnStr) {
      case "success":
        console.log(`Registration successful`);
        res.status(200).json({
          status: responseCodes.REGISTRATION_SUCCESS,
          message: "Succesfully Created Account"
        });
        break;
      case "usernameExists":
        console.log(`Registration failed: Username already exists!`);
        res.status(400).json({
          status: responseCodes.REGISTRATION_USERNAME_IN_USE,
          message: 'Username already in use'
        });
        break;
      case "emailExists":
        console.log(`Registration failed: Email already exists!`);
        res.status(400).json({
          status: responseCodes.REGISTRATION_EMAIL_IN_USE,
          message: 'Email address already in use'
        });
        break;
      default:
        throw Error(`Unhandled return value ${returnStr} from createUniqueAccount()`)
    }

    return ;
  } catch (error) {
    console.log(`Registration unsuccessful: \n ${error}`);
    next(error)
  }
}

exports.authenticateAccount = async (req, res, next) => {
  console.log("Authenticate account requested");

  // Define validation schema
  const authenticateSchema = Joi.object().keys({
    username: Joi.string().required(),
    password: Joi.string().pattern(new RegExp('^[a-zA-Z0-9]{6,30}$')).required(),
    role: Joi.string().valid('sensor', 'citizen', 'brgy').required(),
  });

  // Define local functions
  function generateAccessToken(payload){
    return jwt.sign(
      payload, 
      process.env.ACCESS_TOKEN_PRIVATE_KEY, 
      {expiresIn: process.env.JWT_EXPIRY} // Adds 'exp' in seconds since epoch
    );
  }

  try{
    // Validate input
    const result = authenticateSchema.validate(req.body);
    if(result.error){
      console.log(result.error.details[0].message)
      res.status(400).json({
        status: responseCodes.AUTHENTICATION_ERROR,
        message: result.error.details[0].message
      });
      return;
    }

    // Perform task
    returnStr = await AccountsService.loginAccountRole(
      result.value.username,
      result.value.password,
      result.value.role
    )

    // Respond based on returned value
    switch (returnStr) {
      case "accountNotExists":
        res.status(400).json({ 
          status: responseCodes.AUTHENTICATION_USER_NOT_EXIST,
          message: "User doesn't exists!"
        });
        break;
      case "wrongPassword":
        res.status(401).json({
          status: responseCodes.AUTHENTICATION_WRONG_PASSWORD,
          message: 'Wrong password'
        });
        break;
      case "invalidRole":
        res.status(400).json({
          status: responseCodes.AUTHENTICATION_INVALID_ROLE,
          message: 'Invalid role'
        });
        break;
      case "noLinkedDevice":
        res.status(400).json({
          status: responseCodes.AUTHENTICATION_NO_LINKED_DEVICE,
          message: 'User has no linked device'
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
          message: "Authentication successful"
        })
        break;
      default:
        throw Error(`Unhandled return value ${returnStr} from loginAccountRole()`)
    }

    return;
  } catch(error) {
    console.log(`Authentication unsuccessful: \n ${error}`);
    next(error)
  }
}

exports.verifySensorToken = async (req, res, next) => {
  console.log("Sensor token verification requested");

  // Define validation schema
  const verifySensorTokenSchema = Joi.object().keys({
    token: Joi.string().regex(/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_.+/=]*$/).required()
  });

  try {
    // Validate input
    const result = verifySensorTokenSchema.validate(req.body);
    if(result.error){
      console.log(result.error.details[0].message)
      res.status(400).json({ status: responseCodes.INBEHALF_VERIFICATION_ERROR, message: result.error.details[0].message});
      return;
    }

    // Perform Task
    returnObj = await AccountsService.verifySensorToken(result.value.token, req.username)

    // Respond based on returned value
    switch (returnObj.str) {
      case "JsonWebTokenError":
        res.status(403).json({
          status: responseCodes.INBEHALF_VERIFICATION_INVALID_TOKEN,
          message: "Sender token invalid"
        });
        break;
      case "TokenExpiredError":
        res.status(403).json({
          status: responseCodes.INBEHALF_VERIFICATION_EXPIRED_TOKEN,
          message: "Sender token expired"
        });
        break;
      case "tokenRoleInvalid":
        res.status(403).json({
          status: responseCodes.INBEHALF_VERIFICATION_INVALID_ROLE,
          message: "Role in token invalid"
        });
        break;
      case "brgyNotFound":
        res.status(400).json({
          status: responseCodes.INBEHALF_VERIFICATION_ERROR,
          message: 'Internal error'
        });
        break;
      case "sensorIsValid":
        res.status(200).json({
          status: responseCodes.INBEHALF_VERIFICATION_SUCCESS,
          message: 'Sensor is a valid streamer',
          sensorInfo: {
            username: returnObj.sensor.username,
            role: returnObj.sensor.role, 
            streamIds: returnObj.sensor.streamIds,
            tokenExp: returnObj.sensor.exp,
          },
        });
        break;
      default:
        throw Error(`Unhandled return value ${returnObj} from verifySensorToken()`)
    }

    return;
  } catch(error) {
    console.log(`Sensor verification unsuccessful: \n ${error}`);
    next(error)
  }
}

exports.getAccountProfile = async (req, res, next) => {
  console.log("Account profile requested");

  // No validation schema since this is for GET endpoint

  try {
    // Perform Task
    returnObj = await AccountsService.getAccountProfile(req.username)

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
          status: responseCodes.AUTHENTICATION_SUCCESS,
          message: 'Token is valid', 
          payload: { 
            username: returnObj.profile.username,
            email: returnObj.profile.email
          } 
        });
        break;
      default:
        throw Error(`Unhandled return value ${returnObj} from verifySensorToken()`)
    }

    return;
  } catch (error) {
    console.log(`Unable to get account profile: \n ${error}`);
    next(error)
  }
}

exports.removeCookies = async (req, res, next) => {
  console.log("Sign-out requested");
  try {
    res.clearCookie('accessToken').json({ 
      status: responseCodes.SIGNOUT_SUCCESS,
      message: 'Sign out successful' 
    });
  } catch (error) {
    console.error('Error occurred during signout:', error);
    res.status(500).json({ 
      status: responseCodes.SIGNOUT_ERROR,
      message: 'Error occured during signout' 
    });
  }
}

exports.getBrgyToken = async (req, res, next) => {
  console.log("Brgy access token requested");

  // Define validation schema
  const authenticateSchema = Joi.object().keys({
    username: Joi.string().required(),
    password: Joi.string().pattern(new RegExp('^[a-zA-Z0-9]{6,30}$')).required(),
    role: Joi.string().valid('sensor', 'citizen', 'brgy').required(),
  });

  // Define local functions
  function generateAccessToken(payload){
    return jwt.sign(
      payload, 
      process.env.ACCESS_TOKEN_PRIVATE_KEY, 
      {expiresIn: process.env.JWT_EXPIRY} // Adds 'exp' in seconds since epoch
    );
  }

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

