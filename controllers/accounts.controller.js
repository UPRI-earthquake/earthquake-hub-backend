const bcrypt = require('bcryptjs');
const Joi = require('joi');
const User = require('../models/account.model');
const {
  responseCodes,
  responseMessages
} = require('../routes/responseCodes')

const registerSchema = Joi.object({
  username: Joi.string().required(),
  password: Joi.string().pattern(new RegExp('^[a-zA-Z0-9]{6,30}$')).required(),
  confirmPassword: Joi.equal(Joi.ref('password')).required()
                   .messages({"any.only": "Passwords should match."}),
  email: Joi.string().email({ minDomainSegments: 2, tlds: { allow: ['com', 'net'] } }).required()
});

const createUniqueAccount = async (req, res, next) => { // validate POST body
    console.log("Register account requested");
    try {
      const result = registerSchema.validate(req.body);
      if(result.error){
        console.log(result.error.details[0].message)
        res.status(400).json({
          status: responseCodes.REGISTRATION_ERROR, 
          message: result.error.details[0].message
        });
        return;
      }

      // Check if username is in use
      const usernameExists = await User.findOne({ username: req.body.username });
      if (usernameExists) { // username is already in use
        res.status(400).json({
          status: responseCodes.REGISTRATION_USERNAME_IN_USE,
          message: 'Username already in use'
        });
        return;
      }

      // Check if email is in use
      const emailExists = await User.findOne({ email: req.body.email });
      if (emailExists) { // email is already in use
        res.status(400).json({
          status: responseCodes.REGISTRATION_EMAIL_IN_USE,
          message: 'Email address already in use'
        });
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
      return res.status(200).json({
        status: responseCodes.REGISTRATION_SUCCESS,
        message: "Succesfully Created Account"
      });
    } catch (error) {
      console.log(`Registration unsuccessful: \n ${error}`);
      next(error)
    }
}

module.exports = {
  createUniqueAccount
}
