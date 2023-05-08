const express = require('express');
const router = express.Router();
const Joi = require('joi');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const User = require('../models/account.model');
const Device = require('../models/device.model');

/* validate ./accounts/authenticate endpoint
 *  - role: to be provided by client app
 *      - 'sensor' is for when authenticating from rshake device
 *      - 'citizen' is for when authenticating from webapp frontend
 *      - 'admin' is for when authenticating from webapp admin-frontend
 *      - 'brgy' is for when requesting authentication from ringserver
 * */
const authenticateSchema = Joi.object().keys({
  username: Joi.string().required(),
  password: Joi.string().regex(/^[a-zA-Z0-9]{6,30}$/).required(),
  role: Joi.string().valid('sensor', 'citizen', 'brgy').required()
});

function generateAccessToken(payload){
  return jwt.sign(payload, process.env.ACCESS_TOKEN_PRIVATE_KEY);
}

router.route('/authenticate').post( async (req, res, next) => {
  try{
    const result = authenticateSchema.validate(req.body);
    if(result.error){
      // TODO: know more details on which input is invalid...
      res.status(400).json({ status: 400, message: 'Invalid input'});
      return;
    }

    // get user with devices array populated with device object instead of device id
    const user = await User.findOne({ 'username': result.value.username }).populate('devices');

    if(!user){
      res.status(400).json({ status: 400, message: "User doesn't exists!"});
      return;
    }

    // check if claimed role reflects allowed role in db
    if(!user.roles.includes(result.value.role)){
      res.status(400).json({ status: 400, message: 'Invalid role'});
      return;
    }

    // compare received password with user's password in db
    let passwordIsValid = bcrypt.compareSync(
      result.value.password,
      user.password
    )

    if(!passwordIsValid){
      res.status(401).json({ status: 401, message: 'Wrong password'});
      return;
    }

    switch(result.value.role) {
      case 'sensor':
        // check if account has devices
        if (user.devices.length === 0) {
          res.status(400).json({ status: 400, message: 'User has no linked devices'});
          return;
       }

        // get device stream ids as array of string
        const streamIds = user.devices.map(device => device.streamId);
        // TODO: check if streamid is one string or is a csv of streamids

        // return access token with claims for allowed channels to stream
        res.status(200).json({
          status: 200,
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
          .json({ status: 200, message: "Authentication successful" });
        break;
      case 'brgy':
        // check if brgy account has devices (of their own, or that forwards to them)
        // that they can in turn forward to UP (main receiver)
        if (user.devices.length === 0) {
          res.status(400).json({ status: 400, message: 'Brgy has no forwardable devices'});
          return;
       }

        // return access token in json format, with streamids of SENSORs it can forward
        const brgyStreamIds = user.devices.map(device => device.streamId)
        res.status(200).json({
          status: 200,
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
    next(error)
  }
});


// Middleware: Checks if the token has the correct citizen authority
function getCitizenToken(req, res, next) {
  if(!req.cookies) {
    res.status(403).json({ status: 403, message: "Cookies undefined" })
    return; // don't proceed to next()
  }

  const token = req.cookies.accessToken;
  if(!token) {
    res.status(403).json({ status: 403, message: "Token in cookie missing" })
    return;
  }

  req.token = token;
  next();
}

// Middleware: Checks if the token has the correct brgy authority
function getBrgyToken(req, res, next) {
  const authHeader = req.headers["authorization"]
  if(!authHeader) {
    res.status(403).json({ status: 403, message: "Authorization Header Undefined" });
    return; // don't proceed to next()
  }

  const token = authHeader.split(" ")[1] // authorization: "Bearer <token>"
  if(!token) {
    res.status(403).json({ status: 403, message: "Token in header missing" });
    return;
  }

  req.token = token;
  next();
}

// Middleware: Verify token is valid, and role in token is role in arg
function verifyTokenRole(role) { // wrapper for custom args
  return (req, res, next) => {
    jwt.verify(req.token, process.env.ACCESS_TOKEN_PRIVATE_KEY, (err, decodedToken) => {
      if (err) {
        res.status(403).json({ status: 403, message: "Token invalid" });
        return;
      }
      if (decodedToken.role !== role) {
        res.status(403).json({ status: 403, message: "Role invalid" });
        return;
      }
      req.username = decodedToken.username;
      req.role = decodedToken.role;
      next();
    }) //end of jwt.verify()
  } // end of standard middleware
} // end of wrapper

const verifySensorTokenSchema = Joi.object().keys({
  token: Joi.string().regex(/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_.+/=]*$/).required(),
  role: Joi.string().valid('sensor').required()
});

router.route('/verifySensorToken').post(
  getBrgyToken,
  verifyTokenRole('brgy'),
  (req, res, next) => { // validate POST body
    const result = verifySensorTokenSchema.validate(req.body);
    if(result.error){
      res.status(400).json({ status: 400, message: 'Invalid POST input'});
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
        console.log(err);
        res.status(403).json({ status: 403, message: "Token invalid" });
        return;
      }

      if (decodedToken.role !== 'sensor') { // check that role is sensor (since a token can have a different role and still be valid)
        res.status(403).json({ status: 403, message: "Role in token invalid" });
        return;
      }

      // TODO: Update BRGY table
      // NOTE: That this would look like the new devices are also under/belongs-to the brgy account
      const deviceIds = await Device
        .find({ streamId: { $in: decodedToken.streamIds } })          // get device objectids from the db that corresponds to each streamid
        .then(devices => devices.map(device => device._id));          // map to an array of ObjectId's only

      const brgy = await User.findOne({ 'username': req.username });  // get brgy account, username is on req.username due to verifyTokenRole middleware

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
          status: 200,
          message: 'Sender is a valid streamer with new streamIds',
          accessToken: generateAccessToken({                          // Give the brgy a new authentication token that includes updated streamids
            'username': brgy.username,
            'streamIds': brgyStreamIds,
            'role': 'brgy'
          }),
        });

      }
      else {
        res.status(200).json({ status: 200, message: 'Sensor is a valid streamer'}); //TODO: think of a better message
      }

    }) //end of jwt.verify()
  }
)

router.route('/sample-profile-for-citizen').get(
  getCitizenToken,
  verifyTokenRole('citizen'),
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


const registrationInputValidation = Joi.object().keys({
  username: Joi.string().required(),
  password: Joi.string().pattern(new RegExp('^[a-zA-Z0-9]{3,30}$')).required(),
  confirmPassword: Joi.valid(Joi.ref('password')).required(),
  email: Joi.string().email({ minDomainSegments: 2, tlds: { allow: ['com', 'net'] } }).required()
});

router.route('/register').post(
  async (req, res) => { // validate POST body
    console.log("Register account requested");
    
    try {
      const result = registrationInputValidation.validate(req.body);
      if(result.error){
        console.log(result.error.details[0].message)

        // TODO: write more detailed error message
        res.status(400).json({ status: 400, message: 'Invalid POST input'});
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
  
      console.log(`Create account successful`);
      return res.status(200).json({ status: 200, message: "Succesfully Created Account" });

    } catch (e) {
      console.log(`Create account unsuccessful: \n ${e}`);
      res.status(400).json({ status: 400, message: e.message });
      return;
    }

  }
)



module.exports = router
