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

function generateAccessToken(username_str){
  const payload = {'username': username_str};
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
            'streamids': streamIds
          }),
        });
        break;
      case 'citizen':
        // return access token in http cookie (so it's hidden from browser js)
        res.status(200)
          .cookie("access_token", generateAccessToken({'username': user.username}), {
            httpOnly: true, // set to be accessible only by web browser
            secure: process.env.NODE_ENV === "production", // if cookie is for HTTPS only
          })
          .json({ status: 200, message: "Authentication successful" });
        break;
      case 'brgy':
        // return access token in json format, with streamids of SENSORs it can forward
        const brgyStreamIds = 'AM_RE722_00_EHZ,AM_R3B2D_00_EHZ' // get this from user.accountDetails.devices;
        res.status(200).json({
          status: 200,
          message: 'Login successful',
          accessToken: generateAccessToken({
            'username': user.username,
            'streamids': brgyStreamIds
          }),
        });
        break;
    }
    return;

  } catch(error) {
    next(error)
  }
});

module.exports = router
