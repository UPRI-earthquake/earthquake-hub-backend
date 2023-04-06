const express = require('express');
const router = express.Router();
const Joi = require('joi');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const User = require('../models/account.model');

/* validate ./accounts/authenticate endpoint
 *  - role: to be provided by client app
 *      - 'sensor' is for when authenticating from rshake device
 *      - 'citizen' is for when authenticating from webapp frontend
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

    const user = await User.findOne({ 'username': result.value.username });

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
        // TODO: get device stream ids as csv string
        const streamIds = 'AM_R3B2D_00_EHZ,AM_R3B2D_00_ENN' // get this from user.accountDetails.devices;

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
        // return access token in json format, with streamids of SENSORs it can forward
        const brgyStreamIds = 'AM_RE722_00_EHZ,AM_R3B2D_00_EHZ' // TODO: get this from brgy table
        // TODO: Can we do away with brgyStreamIds? Just tell brgy in token-verification endpoint if they should accept connx request or not?
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

router.route('/protected').get(
  getCitizenToken,
  verifyTokenRole('citizen'),
  (req, res, next) => {
    res.status(200).json({status:200, message:"Done GET on sample endpoint requiring citizen authorization"});
  }
)

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
  (req, res, next) => { // verify SENSOR token in body
    jwt.verify(req.body.token, process.env.ACCESS_TOKEN_PRIVATE_KEY, (err, decodedToken) => {
      if (err) {
        console.log(err);
        res.status(403).json({ status: 403, message: "Token invalid" });
        return;
      }

      if (decodedToken.role !== 'sensor') {
        res.status(403).json({ status: 403, message: "Role in token invalid" });
        return;
      }

      const streamIds = 'AM_R3B2D_00_EHZ,AM_R3B2D_00_ENN' // TODO: get this from decodedToken.username.accountDetails.devices;
      if(streamIds !== decodedToken.streamIds) {
        res.status(403).json({ status: 403, message: "Invalid streamIds" });
        return;
      }

      res.status(200).json({ status: 200, message: 'Sensor is a valid streamer'}); //TODO: think of a better message
    }) //end of jwt.verify()
  }
)


module.exports = router
