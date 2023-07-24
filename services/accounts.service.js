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
  if (await User.findOne({ username: username })) {
    return 'usernameExists';
  }

  // Check if email is in use
  if (await User.findOne({ email: email })) {
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

/***************************************************************************
 * loginAccountRole:
 *     Compares provided username/password with that in DB
 * Inputs:
 *     username: valid username string
 *     password: valid password string
 * Outputs:
 *     "accountNotExists":   if username doesn't exist in DB
 *     "wrongPassword":      if password does NOT match username's password in DB
 *     "invalidRole":        if claimed role is listed as user's role in DB
 *     "noLinkedDevice":     if Sensor/Brgy has no linked device
 *     "successSensorBrgy":  if Sensor/Brgy password matches their password in DB,
 *                           and they have linked devices
 *     "successCitizen":     if Citizen's password matches their's password in DB
 *     
 ***************************************************************************/
exports.loginAccountRole = async (username, password, role) => {
  // get user with its devices array populated by device object (instead of device id)
  const user = await User.findOne({ 'username': username }).populate('devices');

  if(!user){
    return 'accountNotExists';
  }

  // compare received password with user's password in db
  let passwordIsValid = bcrypt.compareSync(
    password,      // received password
    user.password  // password in db
  )

  if(!passwordIsValid){
    return 'wrongPassword';
  }

  // check if claimed role reflects allowed role in db
  if(!user.roles.includes(role)){
    return 'invalidRole';
  }

  switch(role) {
    case 'sensor':
    case 'brgy':
      // check if sensor account has devices OR,
      // check if brgy account has devices (of their own, or that forwards to them)
      // that they can in turn forward to UP (main receiver)
      if (user.devices.length === 0) {
        return 'noLinkedDevice';
      }
      return 'successSensorBrgy'
    case 'citizen':
      return 'successCitizen'
  }
  return "success";
}
