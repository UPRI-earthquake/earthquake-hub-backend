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
  *                   type: number
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
  *                   type: number
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
  *       '500':
  *         description: Internal server error
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               properties:
  *                 status:
  *                   type: number
  *                   example: responseCodes.GENERIC_ERROR
  *                 message:
  *                   type: string
  *                   example: "Server error occured"
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
  *       '200':
  *         description: Authentication successful. ! Varies depending on account role !
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               properties:
  *                 status:
  *                   type: number
  *                   example: responseCodes.AUTHENTICATION_TOKEN_PAYLOAD
  *                 message:
  *                   type: string
  *                   example: "Authentication successful"
  *                 accessToken:
  *                   type: string
  *                   example: "sensor-or-brgy-access-token"
  *                   description: >
  *                     JWT for auth user, this is either in payload/cookie depending on role
  *                      * `sensor`  - returned in JSON response
  *                      * `citizen` - returned in cookie
  *                      * `admin`   - returned in cookie
  *                      * `brgy`    - returned in JSON response
  *         headers: 
  *           Set-Cookie:  # If citizen or admin role
  *             description: If role is citizen or admin, JWT is returned as cookie
  *             schema: 
  *               type: string
  *               example: accessToken=abcde12345; Path=/; HttpOnly
  *       '400':
  *         description: Authentication failed due to various reasons
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               properties:
  *                 status:
  *                   type: number
  *                 message:
  *                   type: string
  *             examples:
  *               accountNotExists:
  *                 value:
  *                   status: responseCodes.AUTHENTICATION_USER_NOT_EXIST
  *                   message: "User doesn't exists!"
  *               invalidRole:
  *                 value:
  *                   status: responseCodes.AUTHENTICATION_INVALID_ROLE
  *                   message: "Invalid role"
  *               noLinkedDevice:
  *                 value:
  *                   status: responseCodes.AUTHENTICATION_NO_LINKED_DEVICE
  *                   message: "User has no linked device"
  *       '401':
  *         description: Authentication failed due to wrong password
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               properties:
  *                 status:
  *                   type: number
  *                   example: responseCodes.AUTHENTICATION_WRONG_PASSWORD
  *                 message:
  *                   type: string
  *                   example: "Wrong password"
  *       '500':
  *         description: Internal server error
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               properties:
  *                 status:
  *                   type: number
  *                   example: responseCodes.GENERIC_ERROR
  *                 message:
  *                   type: string
  *                   example: "Server error occured"
  */
router.route('/authenticate').post(
  AccountsController.authenticateAccount
);


/**
  * @swagger
  * /accounts/signout:
  *   post:
  *     summary: Clear citizen's accessToken in cookie
  *     tags: [Accounts]
  *     security:
  *       - cookieAuth: []
  *     responses:
  *       '200':
  *         description: Sign out successful
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               properties:
  *                 status:
  *                   type: number
  *                   example: responseCodes.SIGNOUT_SUCCESS
  *                 message:
  *                   type: string
  *                   example: "Sign out successful"
  *         headers: 
  *           Set-Cookie:
  *             description: This endpoints clears the accessToken cookie
  *       '403':
  *         description: When no token is present in sent cookie
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               properties:
  *                 status:
  *                   type: number
  *                   example: 403
  *                 message:
  *                   type: string
  *                   example: "Token in cookie missing"
  *       '500':
  *         description: Internal server error
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               properties:
  *                 status:
  *                   type: number
  *                   example: responseCodes.GENERIC_ERROR
  *                 message:
  *                   type: string
  *                   example: "Server error occured"
  */
router.route('/signout').post(
  AccountsController.removeCookies            // Remove accessToken saved in browser's cookie
);


/**
  * @swagger
  * /accounts/verify-sensor-token:
  *   post:
  *     summary: Tell a brgy whether a sensor's JWT came from this server
  *     tags: [Accounts]
  *     security:
  *       - bearerAuth: []  # Indicates that bearer token in header is required
  *     requestBody:
  *       description: Sensor's token that the client (must be a brgy) asks to be verified
  *       required: true
  *       content:
  *         application/json:
  *           schema:
  *             type: object
  *             properties:
  *               token:
  *                 type: string
  *                 description: JWT string
  *                 example: "valid.jsonwebtoken.string"
  *     responses:
  *       '200':
  *         description: Sensor verification successful
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               properties:
  *                 status:
  *                   type: number
  *                   example: responseCodes.INBEHALF_VERIFICATION_SUCCESS
  *                 message:
  *                   type: string
  *                   example: "Sensor is a valid streamer"
  *                 sensorInfo:
  *                   type: object
  *                   properties:
  *                     username:
  *                       type: string
  *                       example: "username_this_sensor_is_linked_to"
  *                     role:
  *                       type: string
  *                       example: "sensor"
  *                     streamIds:
  *                       type: array
  *                       items:
  *                         type: string
  *                         pattern: '^[A-Z]{2}_[A-Z0-9]{5}_\.\*\/MSEED$'
  *                         description: Stream ID of the device (format XX_XXXXX_.*&#8205;/MSEED)
  *                     tokenExp:
  *                       type: number
  *                       example: 1678912345
  *       '400':
  *         description: Sensor verification failed due to invalid request or internal error
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               properties:
  *                 status:
  *                   type: number
  *                   example: responseCodes.INBEHALF_VERIFICATION_ERROR
  *                 message:
  *                   type: string
  *                   example: "Internal error"
  *       '403':
  *         description: Sensor verification failed due to token-related issues
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               properties:
  *                 status:
  *                   type: number
  *                 message:
  *                   type: string
  *             examples:
  *               invalidToken:
  *                 value:
  *                   status: responseCodes.INBEHALF_VERIFICATION_INVALID_TOKEN
  *                   message: "Sender token invalid"
  *               expiredToken:
  *                 value:
  *                   status: responseCodes.INBEHALF_VERIFICATION_EXPIRED_TOKEN
  *                   message: "Sender token expired"
  *               invalidRole:
  *                 value:
  *                   status: responseCodes.INBEHALF_VERIFICATION_INVALID_ROLE
  *                   message: "Role in token invalid"
  *       '500':
  *         description: Internal server error
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               properties:
  *                 status:
  *                   type: number
  *                   example: responseCodes.GENERIC_ERROR
  *                 message:
  *                   type: string
  *                   example: "Server error occured"
  */
router.route('/verify-sensor-token').post(
  Middleware.getTokenFromBearer,          // Brgy token should be assigned to Bearer in request header
  Middleware.verifyTokenWithRole('brgy'), // This endpoint should only be accessed by Brgy Accounts
  AccountsController.verifySensorToken    // Verify sensor's token as provided by the brgy
)


/**
  * @swagger
  * /accounts/profile:
  *   get:
  *     summary: Return user information if accessToken is in cookie
  *     tags: [Accounts]
  *     security:
  *       - cookieAuth: []
  *     responses:
  *       200:
  *         description: Successfully added device to user account
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               properties:
  *                 status:
  *                   type: number
  *                   example: responseCodes.GENERIC_SUCCESS
  *                 message:
  *                   type: string
  *                   example: "Successfully added device"
  *       '400':
  *         description: Device NETWORK and STATION codes are already used
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               properties:
  *                 status:
  *                   type: number
  *                   example: responseCodes.GENERIC_ERROR
  *                 message:
  *                   type: string
  *                   example: "Device details already used"
  *       '403':
  *         description: When no token is present in sent cookie
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               properties:
  *                 status:
  *                   type: number
  *                   example: 403
  *                 message:
  *                   type: string
  *                   example: "Token in cookie missing"
  *       '500':
  *         description: Internal server error
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               properties:
  *                 status:
  *                   type: number
  *                   example: responseCodes.GENERIC_ERROR
  *                 message:
  *                   type: string
  *                   example: "Server error occured"
  */
router.route('/profile').get(
  Middleware.getTokenFromCookie,             // Citizen token is stored in cookie
  Middleware.verifyTokenWithRole('citizen'), // This enpoint should only be accessible to Citizen Accounts
  AccountsController.getAccountProfile       // Get profile information and respond accordingly
);

router.route('/acquire-brgy-token').post(    // This endpoint is used by brgy accounts for acquiring brgy token
  Middleware.getTokenFromCookie,             // Brgy token is stored in cookie
  Middleware.verifyTokenWithRole('brgy'),    // This endpoint should only be accessible to Brgy Accounts
  AccountsController.getBrgyToken            // Get brgy token and respond accordingly
);


module.exports = router
