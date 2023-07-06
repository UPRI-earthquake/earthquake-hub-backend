const bcrypt = require('bcryptjs');
const User = require('../models/account.model');

/***************************************************************************
 * createUniqueAccount:
 *     Creates a new account entry in DB if it doesn't yet exist. 
 * Inputs:
 *     username: valid username string
 *     email:    valid email string
 *     password: valid password string
 * Outputs:
 *     "success":        if account was successfully added
 *     "usernameExists": if username is already in use
 *     "emailExists":    if email is already in use
 *     
 ***************************************************************************/
exports.createUniqueAccount = async (username, email, password) => {
  // Check if username is in use
  const usernameExists = await User.findOne({ username: username });
  if (usernameExists) { // username is already in use
    return 'usernameExists';
  }

  // Check if email is in use
  const emailExists = await User.findOne({ email: email });
  if (emailExists) { // email is already in use
    return 'emailExists';
  }

  // save inputs to database
  const hashedPassword = bcrypt.hashSync(password, 10); // hash the password before saving to database
  const newAccount = new User({
    username: username,
    email: email,
    password: hashedPassword,
    roles: ["citizen", "sensor"] // TODO: Make this an attribute to POST route too
  });
  await newAccount.save();

  return "success";
}
