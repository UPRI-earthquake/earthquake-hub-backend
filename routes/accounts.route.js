const express = require('express');
const router = express.Router();
const Joi = require('joi');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const User = require('../models/account.model');
const Device = require('../models/device.model');
const {
  getTokenFromCookie,
  getTokenFromBearer,
  verifyTokenWithRole
} = require('../middlewares/token.middleware')

const {
  responseCodes,
  responseMessages
} = require('./responseCodes')

// --- REGISTRATION ---

const registerSchema = Joi.object({
  username: Joi.string().required(),
  password: Joi.string().pattern(new RegExp('^[a-zA-Z0-9]{6,30}$')).required(),
  confirmPassword: Joi.equal(Joi.ref('password')).required()
                   .messages({"any.only": "Passwords should match."}),
  email: Joi.string().email({ minDomainSegments: 2, tlds: { allow: ['com', 'net'] } }).required()
});

router.route('/register').post(
  async (req, res) => { // validate POST body
    console.log("Register account requested");

    try {
      const result = registerSchema.validate(req.body);
      if(result.error){
        console.log(result.error.details[0].message)
        res.status(400).json({ status: 400, message: result.error.details[0].message});
        return;
      }

      // Check if username is in use
      const usernameExists = await User.findOne({ username: req.body.username });
      if (usernameExists) { // username is already in use
        res.status(400).json({ status: 400, message: 'Username already in use'});
        return;
      }

      // Check if email is in use
      const emailExists = await User.findOne({ email: req.body.email });
      if (emailExists) { // email is already in use
        res.status(400).json({ status: 400, message: 'Email address already in use'});
        return;
      }

      // save inputs to database
      const hashedPassword = bcrypt.hashSync(req.body.password, 10); // hash the password before saving to database

      const newAccount = new User({
        username: req.body.username,
        email: req.body.email,
        password: hashedPassword,
        roles: ["citizen", "sensor"]
      });
      await newAccount.save();

      console.log(`Account creation successful successful`);
      return res.status(200).json({ status: 200, message: "Succesfully Created Account" });

    } catch (error) {
      console.log(`Registration unsuccessful: \n ${error}`);
      next(error)
    }

  }
)

// --- LOGIN/AUTHENTICATION ---

/* validate ./accounts/authenticate endpoint
 *  - role: to be provided by client app
 *      - 'sensor' is for when authenticating from rshake device
 *      - 'citizen' is for when authenticating from webapp frontend
 *      - 'admin' is for when authenticating from webapp admin-frontend
 *      - 'brgy' is for when requesting authentication from ringserver
 * */
const authenticateSchema = Joi.object().keys({
  username: Joi.string().required(),
  password: Joi.string().pattern(new RegExp('^[a-zA-Z0-9]{6,30}$')).required(),
  role: Joi.string().valid('sensor', 'citizen', 'brgy').required(),
});

function generateAccessToken(payload){
  return jwt.sign(payload, process.env.ACCESS_TOKEN_PRIVATE_KEY, {expiresIn: '30 days'}); // Add 'exp' in seconds since epoch
}

router.route('/authenticate').post( async (req, res, next) => {
  try{
    const result = authenticateSchema.validate(req.body);
    if(result.error){
      console.log(result.error.details[0].message)
      res.status(400).json({ status: responseCodes.AUTHENTICATION_ERROR, message: result.error.details[0].message});
      return;
    }

    // get user with devices array populated with device object instead of device id
    const user = await User.findOne({ 'username': result.value.username }).populate('devices');

    if(!user){
      res.status(400).json({ status: responseCodes.AUTHENTICATION_USER_NOT_EXIST, message: "User doesn't exists!"});
      return;
    }

    // check if claimed role reflects allowed role in db
    if(!user.roles.includes(result.value.role)){
      res.status(400).json({ status: responseCodes.AUTHENTICATION_INVALID_ROLE, message: 'Invalid role'});
      return;
    }

    // compare received password with user's password in db
    let passwordIsValid = bcrypt.compareSync(
      result.value.password,
      user.password
    )

    if(!passwordIsValid){
      res.status(401).json({ status: responseCodes.AUTHENTICATION_WRONG_PASSWORD, message: 'Wrong password'});
      return;
    }

    switch(result.value.role) {
      case 'sensor':
        // check if account has devices
        if (user.devices.length === 0) {
          res.status(400).json({ status: responseCodes.AUTHENTICATION_NO_LINKED_DEVICE, message: 'User has no linked devices'});
          return;
       }

        // get device stream ids as array of string
        const streamIds = user.devices.map(device => device.streamId);
        // TODO: check if streamid is one string or is a csv of streamids

        // return access token with claims for allowed channels to stream
        res.status(200).json({
          status: responseCodes.AUTHENTICATION_TOKEN_PAYLOAD,
          message: 'Authentication successful',
          accessToken: generateAccessToken({
            'username': user.username,
            'streamIds': streamIds,
            'role': 'sensor'
          }),
        });
        break;
      case 'citizen':
        // return access token in http cookie (so it's hidden from browser js)
        res.status(200)
          .cookie("accessToken", generateAccessToken({'username': user.username, 'role': 'citizen'}), {
            httpOnly: true, // set to be accessible only by web browser
            secure: process.env.NODE_ENV === "production", // if cookie is for HTTPS only
          })
          .json({ status: responseCodes.AUTHENTICATION_TOKEN_COOKIE, message: "Authentication successful" });
        break;
      case 'brgy':
        // check if brgy account has devices (of their own, or that forwards to them)
        // that they can in turn forward to UP (main receiver)
        if (user.devices.length === 0) {
          res.status(400).json({ status: responseCodes.AUTHENTICATION_NO_LINKED_DEVICE, message: 'Brgy has no forwardable devices'});
          return;
       }

        // return access token in json format, with streamids of SENSORs it can forward
        const brgyStreamIds = user.devices.map(device => device.streamId)
        res.status(200).json({
          status: responseCodes.AUTHENTICATION_TOKEN_PAYLOAD,
          message: 'Login successful',
          accessToken: generateAccessToken({
            'username': user.username,
            'streamIds': brgyStreamIds,
            'role': 'brgy'
          }),
        });
        break;
    }
    return;

  } catch(error) {
    console.log(`Authentication unsuccessful: \n ${error}`);
    next(error)
  }
});

// --- VERIFICATION ---

const verifySensorTokenSchema = Joi.object().keys({
  token: Joi.string().regex(/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_.+/=]*$/).required()
});

router.route('/verifySensorToken').post(
  getTokenFromBearer,
  verifyTokenWithRole('brgy'),
  (req, res, next) => { // validate POST body
    const result = verifySensorTokenSchema.validate(req.body);
    if(result.error){
      console.log(result.error.details[0].message)
      res.status(400).json({ status: responseCodes.INBEHALF_VERIFICATION_ERROR, message: result.error.details[0].message});
      return;
    }
    next();
  },
  (req, res, next) => {
    // Verify SENSOR token in body, valid if it enters callback w/o err
    // Valid means:
    // it has right to send data to UP
    // it the streamids the token claims to have access to are given/permitted by UP
    jwt.verify(req.body.token, process.env.ACCESS_TOKEN_PRIVATE_KEY, async (err, decodedToken) => {
      if (err) {
        if (err.name == 'JsonWebTokenError'){
          res.status(403).json({
            status: responseCodes.INBEHALF_VERIFICATION_INVALID_TOKEN,
            message: "Sender token invalid"
          });
        } else if (err.name == 'TokenExpiredError'){
          res.status(403).json({
            status: responseCodes.INBEHALF_VERIFICATION_EXPIRED_TOKEN,
            message: "Sender token expired"
          });
        }
        return;
      }

      // TODO: This can also be brgy!! A brgy can also act as a sender to UP ringserver...
      if (decodedToken.role !== 'sensor') { // check that role is sensor (since a token can have a different role and still be valid)
        res.status(403).json({
          status: responseCodes.INBEHALF_VERIFICATION_INVALID_ROLE,
          message: "Role in token invalid"
        });
        return;
      }

      // TODO: Update BRGY table
      // NOTE: That this would look like the new devices are also under/belongs-to the brgy account
      const deviceIds = await Device
        .find({ streamId: { $in: decodedToken.streamIds } })          // get device objectids from the db that corresponds to each streamid
        .then(devices => devices.map(device => device._id));          // map to an array of ObjectId's only

      const brgy = await User.findOne({ 'username': req.username });  // get brgy account, username is on req.username due to verifyTokenRole middleware
      if( ! brgy) {
        console.log( 'Brgy account is valid but not found in DB!!')
        res.status(400).json({
          status: responseCodes.INBEHALF_VERIFICATION_ERROR,
          message: 'Internal error'});
        return;
      }

      let brgyAccountUpdated = false
      for (let i = 0; i < deviceIds.length; i++) {                    // for each deviceId, check if brgy.devices already contains it
        const deviceId = deviceIds[i];

        if (brgy.devices.includes(deviceId)) {                        // If the device is already in the brgy.devices array, skip it
          continue;
        }

        brgy.devices.push(deviceId);                                  // If the device is not in the brgy.devices array, add it
        brgyAccountUpdated = true;
      }

      if (brgyAccountUpdated === true) {
        await brgy.save();                                            // Save the updated brgy account object
        const brgyStreamIds = brgy.devices.map(device => device.streamId)

        res.status(200).json({
          status: responseCodes.INBEHALF_VERIFICATION_SUCCESS_NEW_TOKEN,
          message: 'Sender is a valid streamer with new streamIds',
          decodedSenderToken: {
            streamIds: decodedToken.streamIds,
            exp: decodedToken.exp,
          },
          accessToken: generateAccessToken({                          // Give the brgy a new authentication token that includes updated streamids
            'username': brgy.username,
            'streamIds': brgyStreamIds,
            'role': 'brgy'
          }),
        });

      }
      else {
        res.status(200).json({
          status: responseCodes.INBEHALF_VERIFICATION_SUCCESS,
          message: 'Sensor is a valid streamer',
          decodedSenderToken: {
            streamIds: decodedToken.streamIds,
            exp: decodedToken.exp,
          },
        }); //TODO: think of a better message
      }

    }) //end of jwt.verify()
  }
)

router.route('/profile').get(
  getTokenFromCookie,
  verifyTokenWithRole('citizen'),
  async (req, res) => {
    try {
      console.log('GET request sent on /profile endpoint');
      const citizen = await User.findOne({ 'username': req.username });

      if (!citizen) { // User is not found in database
        return res.status(409).json({
          message: 'User not found'
        });
      }

      res.status(200).json({message: 'Token is valid', 
        payload: { 
          username: citizen.username,
          email: citizen.email
        } 
      });
    } catch (error) {
      console.error('Error occurred during authTokenCheck:', error);
      res.status(500).json({ error: 'Error checking token in cookie' });
    }
  }
);

router.route('/signout').post(
  getTokenFromCookie,
  verifyTokenWithRole('citizen'),
  (req, res) => {
    try {
      res.clearCookie('accessToken').json({ message: 'Sign out successful' });
    } catch (error) {
      console.error('Error occurred during signout:', error);
      res.status(500).json({ error: 'Error occured during signout' });
    }
});

router.route('/sample-profile-for-citizen').get(
  getTokenFromCookie,
  verifyTokenWithRole('citizen'),
  // TODO: Do we need to check the username?
  async (req, res, next) => {
    const citizen = await User.findOne({ 'username': req.username });  // get citizen account, username is on req.username due to verifyTokenRole middleware
    res.status(200).json({
      status:200,
      message:"Done GET on sample endpoint requiring citizen authorization",
      samplePrivateResourceForUserCitizen: citizen.email
    });
  }
)

module.exports = router
