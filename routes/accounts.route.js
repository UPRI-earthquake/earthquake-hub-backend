/**
 * @swagger
 * components:
 *   schemas:
 *     Account:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           description: The auto-generated ObjectId of the account
 *         email:
 *           type: string
 *           description: The email address of the account
 *         username:
 *           type: string
 *           description: The username of the account
 *         password:
 *           type: string
 *           description: The password of the account
 *         accountStatus:
 *           type: string
 *           description: The status of the account
 *           enum:
 *             - Inactive
 *             - Active
 *         roles:
 *           type: array
 *           items:
 *             type: string
 *           description: The roles associated with the account 
 *           enum:
 *             - sensor  # 'sensor' is for when authenticating from rshake device
 *             - citizen # 'citizen' is for when authenticating from webapp frontend
 *             - admin   # 'admin' is for when authenticating from webapp admin-frontend
 *             - brgy    # 'brgy' is for when requesting authentication from ringserver
 *         devices:
 *           type: array
 *           items:
 *             type: objectId
 *           description: The devices associated with the account
 *       example:
 *         _id: 6151ec04b417ad001ff7d343
 *         email: test@gmail.com
 *         username: testuser
 *         password: testpassword
 *         roles:
 *           - sensor
 *           - citizen
 *         accountStatus: inactive
 *         devices:
 *           - 6151ec04b417ad001ff7d345
 *           - 6151ec04b417ad001ff7d346
 *     
 */

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

const AccountsController = require('../controllers/accounts.controller')

const {
  responseCodes,
  responseMessages
} = require('./responseCodes')


/**
 * @swagger
 * /accounts/register:
 *   post:
 *     summary: Endpoint for registering a new user to the earthquake-hub network
 *     tags:
 *       - Accounts
 *     requestBody:
 *       description: Account details for registration
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 description: Email address of the user who wants to register to the network
 *               username:
 *                 type: string
 *                 description: Account's username to be used
 *               password:
 *                 type: string
 *                 description: Account's password
 *               confirmPassword:
 *                 type: string
 *                 description: Account's repeat password
 *           example:
 *             email: citizen123@gmail.com
 *             username: citizen123
 *             password: testpassword
 *             confirmPassword: testpassword
 *     responses:
 *       200:
 *         description: Account registered successfully
 *       500:
 *         description: Internal server error
 */
router.route('/register').post(
  AccountsController.registerAccount
)


/**
 * @swagger
 * /accounts/authenticate:
 *   post:
 *     summary: Endpoint for authenticating a user based on his account role. This endpoint returns a json-web-token
 *     tags:
 *       - Auth Server
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       description: User credentials for authentication
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *                 description: Username used in registration
 *               password:
 *                 type: string
 *                 description: Account's password
 *               role:
 *                 type: string
 *                 description: To be provided by client app (in reference to where it is authenticating from)
 *                 enum:
 *                   - sensor  # 'sensor' is for when authenticating from rshake device
 *                   - citizen # 'citizen' is for when authenticating from webapp frontend
 *                   - admin   # 'admin' is for when authenticating from webapp admin-frontend
 *                   - brgy    # 'brgy' is for when requesting authentication from ringserver
 *             example:
 *               username: citizen
 *               password: testpassword
 *               role: citizen
 *     responses:
 *       200:
 *         description: Authentication successful
 *       400:
 *         description: Bad request - Invalid input or user does not exist
 *       401:
 *         description: Unauthorized - Invalid password
 *       500:
 *         description: Internal server error
 */
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

    // get user with its devices array populated by device object (instead of device id)
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
      result.value.password, // received password
      user.password          // password in db
    )

    if(!passwordIsValid){
      res.status(401).json({ status: responseCodes.AUTHENTICATION_WRONG_PASSWORD, message: 'Wrong password'});
      return;
    }

    switch(result.value.role) {
      case 'sensor':
      case 'brgy':
        // check if sensor account has devices OR,
        // check if brgy account has devices (of their own, or that forwards to them)
        // that they can in turn forward to UP (main receiver)
        if (user.devices.length === 0) {
          res.status(400).json({ status: responseCodes.AUTHENTICATION_NO_LINKED_DEVICE, message: 'User has no linked devices'});
          return;
        }
        // return access token with claims for allowed channels to stream
        res.status(200).json({
          status: responseCodes.AUTHENTICATION_TOKEN_PAYLOAD,
          message: 'Authentication successful',
          accessToken: generateAccessToken({
            'username': user.username,
            'role': result.value.role
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
    }
    return;
  } catch(error) {
    console.log(`Authentication unsuccessful: \n ${error}`);
    next(error)
  }
});

// --- VERIFICATION ---
// Input: Token
// Output: Whether token is valid or not

const verifySensorTokenSchema = Joi.object().keys({
  token: Joi.string().regex(/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_.+/=]*$/).required()
});

router.route('/verify-sensor-token').post(
  getTokenFromBearer,
  verifyTokenWithRole('brgy'),
  (req, res, next) => {
    // validate POST body
    const result = verifySensorTokenSchema.validate(req.body);
    if(result.error){
      console.log(result.error.details[0].message)
      res.status(400).json({ status: responseCodes.INBEHALF_VERIFICATION_ERROR, message: result.error.details[0].message});
      return;
    }

    // Verify SENSOR token in body, valid if it enters callback w/o err
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

      // NOTE: A brgy can also act as a sender to UP ringserver...
      if (! (decodedToken.role == 'sensor' || decodedToken.role == 'brgy')) { // check that role is sensor or brgy (since a token can have a different role and still be valid)
        res.status(403).json({
          status: responseCodes.INBEHALF_VERIFICATION_INVALID_ROLE,
          message: "Role in token invalid"
        });
        return;
      }

      // Get streamIds (will be sent as response) and ObjectId (used to update brgy table) of sensor
      const sensor = await User.findOne({ 'username': decodedToken.username }).populate('devices'); // populate devices array with object itself instead of just ids
      const sensorStreamIds = sensor.devices.map(device => device.streamId)
      const sensorDeviceIds = sensor.devices.map(device => device._id)

      // Update device list of brgy to include this sensor (so that UP server, which can
      // be seen as also a brgy, will allow this brgy to forward sensor's data)
      // NOTE: That this would look like the new devices are also under/belongs-to the brgy account
      const brgy = await User.findOne({ 'username': req.username });  // brgy account, username is on req.username due to verifyTokenRole middleware
      if( ! brgy) {
        console.log( 'Brgy account is valid but not found in DB!!')
        res.status(400).json({
          status: responseCodes.INBEHALF_VERIFICATION_ERROR,
          message: 'Internal error'});
        return;
      }

      // Add sensorDeviceIds to brgy table
      let brgyAccountUpdated = false
      for (let i = 0; i < sensorDeviceIds.length; i++) {              // for each deviceId, check if brgy.devices already contains it
        const deviceId = sensorDeviceIds[i];

        if (brgy.devices.includes(deviceId)) {                        // If the device is already in the brgy.devices array, skip it
          continue;
        }

        brgy.devices.push(deviceId);                                  // If the device is not in the brgy.devices array, add it
        brgyAccountUpdated = true;
      }

      if (brgyAccountUpdated === true) {
        await brgy.save();                                            // Save the updated brgy account object
      }

      res.status(200).json({
        status: responseCodes.INBEHALF_VERIFICATION_SUCCESS,
        message: 'Sensor is a valid streamer',
        sensorInfo: {
          username: decodedToken.username,
          role: decodedToken.role, 
          streamIds: sensorStreamIds,
          tokenExp: decodedToken.exp,
        },
      });
    }) //end of jwt.verify()
  }
)


/**
 * @swagger
 * /accounts/profile:
 *   get:
 *     summary: Endpoint for getting the profile information of a citizen user
 *     tags:
 *       - Accounts
 *     responses:
 *       200:
 *         description: Successful response with user profile information sent as payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: number
 *                   description: HTTP status code
 *                 message:
 *                   type: string
 *                   description: A descriptive message
 *                 payload:
 *                   type: object
 *                   properties:
 *                     username:
 *                       type: string
 *                       description: Username of the user
 *                     email:
 *                       type: string
 *                       description: Email of the user
 *       400:
 *         description: User not found
 *       500:
 *         description: Error checking token in cookie
 */
router.route('/profile').get(
  getTokenFromCookie,
  verifyTokenWithRole('citizen'),
  async (req, res) => {
    try {
      console.log('GET request sent on /profile endpoint');
      const citizen = await User.findOne({ 'username': req.username });

      if (!citizen) { // User is not found in database
        return res.status(400).json({
          status: responseCodes.AUTHENTICATION_USER_NOT_EXIST,
          message: 'User not found'
        });
      }

      res.status(200).json({
        status: responseCodes.AUTHENTICATION_SUCCESS,
        message: 'Token is valid', 
        payload: { 
          username: citizen.username,
          email: citizen.email
        } 
      });
    } catch (error) {
      console.error('Error occurred', error);
      res.status(500).json({ 
        status: responseCodes.AUTHENTICATION_ERROR,
        message: 'Error checking token in cookie' 
      });
    }
  }
);

router.route('/signout').post(
  getTokenFromCookie,
  verifyTokenWithRole('citizen'),
  (req, res) => {
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
