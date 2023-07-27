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

const Middleware = require('../middlewares/token.middleware')
const AccountsController = require('../controllers/accounts.controller')


/**
  * @swagger
  * /accounts/register:
  *   post:
  *     tags: [Accounts]
  *     summary: Create a new account given user information
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
  *                 description: Valid email address of the user who wants to register to the network
  *               username:
  *                 type: string
  *                 description: Unique username to be used
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
  *         description: Registration successful
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               properties:
  *                 status:
  *                   type: int
  *                   example: responseCodes.REGISTRATION_SUCCESS
  *                 message:
  *                   type: string
  *                   example: "Successfully Created Account"
  *       400:
  *         description: Registration failed due to existing username or email
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               properties:
  *                 status:
  *                   type: int
  *                 message:
  *                   type: string
  *             examples:
  *               usernameExists:
  *                 value:
  *                   status: responseCodes.REGISTRATION_USERNAME_IN_USE
  *                   message: "Username already in use"
  *               emailExists:
  *                 value:
  *                   status: responseCodes.REGISTRATION_EMAIL_IN_USE
  *                   message: "Email address already in use"
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
  *     summary: Return a JWT in exchange for username, password, & role
  *     tags: [Accounts]
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
  *                 description: Registered username
  *               password:
  *                 type: string
  *                 description: Account's password
  *               role:
  *                 type: enum[string]
  *                 description: >
  *                   Account role, depends on where to auth from:
  *                    * `sensor`  - when authenticating from rshake device
  *                    * `citizen` - when authenticating from webapp frontend
  *                    * `admin`   - when authenticating from webapp admin-frontend
  *                    * `brgy`    - when authenticating from ringserver
  *           example:
  *             username: citizen
  *             password: testpassword
  *             role: citizen
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
  Middleware.getTokenFromBearer,          // Brgy token should be assigned to Bearer in request header
  Middleware.verifyTokenWithRole('brgy'), // This endpoint should only be accessed by Brgy Accounts
  AccountsController.verifySensorToken    // Verify sensor's token as provided by the brgy
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
  Middleware.getTokenFromCookie,             // Citizen token is stored in cookie
  Middleware.verifyTokenWithRole('citizen'), // This enpoint should only be accessible to Citizen Accounts
  AccountsController.getAccountProfile       // Get profile information and respond accordingly
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
  Middleware.getTokenFromCookie,              // Citizen token is stored in cookie
  Middleware.verifyTokenWithRole('citizen'),  // This enpoint should only be accessible to Citizen Accounts
  AccountsController.removeCookies            // Get profile information and respond accordingly
);

module.exports = router
