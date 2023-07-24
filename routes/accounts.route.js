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
router.route('/authenticate').post(
  AccountsController.authenticateAccount
);

// --- VERIFICATION ---
// Input: Token
// Output: Whether token is valid or not

router.route('/verify-sensor-token').post(
  getTokenFromBearer,                  // Brgy token should be assigned to Bearer in request header
  verifyTokenWithRole('brgy'),         // This endpoint should only be accessed by Brgy Accounts
  AccountsController.verifySensorToken // Verify sensor's token as provided by the brgy
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


/**
  * @swagger
  * /accounts/signout:
  *   post:
  *     summary: Endpoint for signing out a user by clearing the access token cookie
  *     tags:
  *       - Accounts
  *     security:
  *       - cookieAuth: []
  *     responses:
  *       200:
  *         description: Sign out successful
  *       500:
  *         description: Internal server error
  */
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

module.exports = router
