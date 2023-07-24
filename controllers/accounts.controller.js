const Joi = require('joi');
const jwt = require('jsonwebtoken');
const AccountsService = require('../services/accounts.service');
const {
  responseCodes,
  responseMessages
} = require('../routes/responseCodes')

exports.registerAccount = async (req, res, next) => {
  console.log("Register account requested");

  // Define validation schema
  const registerSchema = Joi.object({
    username: Joi.string().required(),
    password: Joi.string().pattern(new RegExp('^[a-zA-Z0-9]{6,30}$')).required(),
    confirmPassword: Joi.equal(Joi.ref('password')).required()
                     .messages({"any.only": "Passwords should match."}),
    email: Joi.string().email({ minDomainSegments: 2, tlds: { allow: ['com', 'net'] } }).required()
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
      result.value.username,
      result.value.email,
      result.value.password
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
        throw Error("Unhandled return value from createUniqueAccount()")
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
        res.status(200).json({
          status: responseCodes.AUTHENTICATION_TOKEN_PAYLOAD,
          message: 'Authentication successful',
          // return access token as part of json payload
          accessToken: generateAccessToken({
            'username': result.value.username,
            'role': result.value.role
          }),
        });
        break;
      case "successCitizen":
        res.status(200).json({
          status: responseCodes.AUTHENTICATION_TOKEN_COOKIE,
          message: "Authentication successful"
        })
        // return access token in http cookie (so it's hidden from browser js)
        .cookie(
          "accessToken",
          generateAccessToken({'username': result.value.username, 'role': 'citizen'}),
          {
            httpOnly: true, // set to be accessible only by web browser
            secure: process.env.NODE_ENV === "production", // if cookie is for HTTPS only
          }
        );
        break;
      default:
        throw Error("Unhandled return value from createUniqueAccount()")
    }

    return;
  } catch(error) {
    console.log(`Authentication unsuccessful: \n ${error}`);
    next(error)
  }
}
