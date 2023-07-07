const Joi = require('joi');
const AccountsService = require('../services/accounts.service');
const {
  responseCodes,
  responseMessages
} = require('../routes/responseCodes')

exports.registerAccount = async (req, res, next) => { // validate POST body
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
