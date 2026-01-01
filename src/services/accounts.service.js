const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/account.model');
const Device = require('../models/device.model');
const { passwordSchema, CURRENT_PASSWORD_POLICY_VERSION, LEGACY_PASSWORD_POLICY_VERSION } = require('../controllers/helpers');

/***************************************************************************
  * createUniqueAccount:
  *     Creates a new account entry in DB if it doesn't yet exist. 
  * Inputs:
  *     username: valid username string
  *     email:    valid email string
  *     password: valid password string
  * Outputs:
  *     "success":                if account was successfully added
  *     "usernameExists":         if username is already in use
  *     "emailExists":            if email is already in use
  *     "ringserverUrlExists":    if ringserverUrl is already in use
  *     
 ***************************************************************************/
exports.createUniqueAccount = async (role, username, email, password, ringserverUrl, ringserverPort) => {
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
  let newAccount = null;

  switch (role) {
    case 'brgy':
      // Check if ringserverUrl is in use
      if (await User.findOne({ ringserverUrl: ringserverUrl })) {
        return 'ringserverUrlExists';
      }

      newAccount = new User({
        username: username,
        email: email,
        password: hashedPassword,
        roles: ["brgy"], // TODO: Make this an attribute to POST route too
        ringserverUrl: ringserverUrl,
        ringserverPort: ringserverPort,
        passwordPolicyVersion: CURRENT_PASSWORD_POLICY_VERSION,
        passwordUpdatedAt: new Date(),
      });
      break;
  
    case 'citizen':
      newAccount = new User({
        username: username,
        email: email,
        password: hashedPassword,
        roles: ["citizen", "sensor"], // TODO: Make this an attribute to POST route too
        passwordPolicyVersion: CURRENT_PASSWORD_POLICY_VERSION,
        passwordUpdatedAt: new Date(),
      });
      break;
  }

  await newAccount.save();

  return "success";
}

/***************************************************************************
  * loginAccountRole:
  *     Compares provided username/password & role with that in DB
  * Inputs:
  *     username: valid username string
  *     password: valid password string
  * Outputs:
  *     "accountNotExists":    if username doesn't exist in DB
  *     "wrongPassword":       if password does NOT match username's password in DB
  *     "invalidRole":         if claimed role is listed as user's role in DB
  *     "successSensorBrgy":   if Sensor/Brgy password matches their password in DB,
  *                            and they have linked devices
  *     "successCitizen":      if Citizen's password matches their's password in DB
  *     "brgyAccountInactive": if Brgy is registered but not yet approved by admin
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

  // Track whether the provided password meets the current policy without blocking legacy users
  const passwordValidation = passwordSchema('Password').validate(password);
  const meetsCurrentPolicy = !passwordValidation.error;
  const currentPolicyVersion = user.passwordPolicyVersion || LEGACY_PASSWORD_POLICY_VERSION;
  let updatedPolicyVersion = currentPolicyVersion;
  if (meetsCurrentPolicy && currentPolicyVersion !== CURRENT_PASSWORD_POLICY_VERSION) {
    updatedPolicyVersion = CURRENT_PASSWORD_POLICY_VERSION;
    user.passwordPolicyVersion = CURRENT_PASSWORD_POLICY_VERSION;
    user.passwordUpdatedAt = new Date();
    await user.save();
  } else if (!user.passwordPolicyVersion) {
    user.passwordPolicyVersion = LEGACY_PASSWORD_POLICY_VERSION;
    await user.save();
  }

  const passwordStatus = (updatedPolicyVersion >= CURRENT_PASSWORD_POLICY_VERSION && meetsCurrentPolicy)
    ? 'current'
    : 'legacy';

  switch(role) {
    case 'sensor':
      return { str: 'successSensorBrgy', passwordStatus, passwordPolicyVersion: updatedPolicyVersion }
    case 'brgy':
      // check if brgy account is approved
      if (!user.isApproved) {
        return 'brgyAccountInactive';
      }
      return { str: 'successSensorBrgy', passwordStatus, passwordPolicyVersion: updatedPolicyVersion }
    case 'citizen':
      return { str: 'successCitizen', passwordStatus, passwordPolicyVersion: updatedPolicyVersion }
  }
  return { str: "success", passwordStatus, passwordPolicyVersion: updatedPolicyVersion };
}

/***************************************************************************
  * verifySensorToken:
  *     Verifies, in behalf of brgy, if a sensor token came from us and 
  *     has role = sensor or brgy.
  *     Also adds the device to the brgy's linked devices if not it's the 
  *     first time the brgy is verify it.
  * Inputs:
  *     token:         JSON web token
  *     brgyUsername:  brgy's username that is asking to verify the token
  * Outputs obj.str:
  *     "JsonWebTokenError": Generic JWT error
  *     "TokenExpiredError": Token expired
  *     "tokenRoleInvalid":  Role is not sensor or brgy
  *     "brgyNotFound":      Brgy account is valid but not found in DB!!
  *     "sensorIsValid":     Sensor owner of token is a valid streamer
  * Outputs obj.sensor:
  *     Will contain sensor info based on decoded JWT
  *     {username, role, streamIds, tokenExp}
  *     
 ***************************************************************************/
exports.verifySensorToken = async (token, brgyUsername) => {
  return new Promise((resolve, reject) => { // wrap in Promise so we can await jwt.verify
    // Verify SENSOR token in body, valid if it enters callback w/o err
    jwt.verify(token, process.env.ACCESS_TOKEN_PRIVATE_KEY, async (err, decodedToken) => {
      if (err) {
        if (err.name == 'JsonWebTokenError'){
          resolve({str: err.name})
        } else if (err.name == 'TokenExpiredError'){
          resolve({str: err.name})
        }
        reject(err)
      }

      // NOTE: A brgy can also act as a sender to UP ringserver...
      if (! (decodedToken.role == 'sensor' || decodedToken.role == 'brgy')) { // check that role is sensor or brgy (since a token can have a different role and still be valid)
        resolve({str: 'tokenRoleInvalid'});
      }

      // Get streamIds (will be sent as response) and ObjectId (used to update brgy table) of sensor
      const sensor = await User.findOne({ 'username': decodedToken.username }).populate('devices'); // populate devices array with object itself instead of just ids
      const sensorStreamIds = sensor.devices.map(device => device.streamId)
      const sensorDeviceIds = sensor.devices.map(device => device._id)

      // Update device list of brgy to include this sensor (so that UP server, which can
      // be seen as also a brgy, will allow this brgy to forward sensor's data)
      // NOTE: That this would look like the new devices are also under/belongs-to the brgy account
      const brgy = await User.findOne({ 'username': brgyUsername });  // brgy account, username is on req.username due to verifyTokenRole middleware
      if( ! brgy) {
        console.log( 'Brgy account is valid but not found in DB!!')
        resolve({str: 'brgyNotFound'});
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

      resolve({
        str: 'sensorIsValid',
        sensor:{
          username: decodedToken.username,
          role: decodedToken.role, 
          streamIds: sensorStreamIds,
          tokenExp: decodedToken.exp,
        }
      });
    }) //end of jwt.verify()
  }) //end of Promise
}

/***************************************************************************
  * removeDeviceFromBrgyByStreamId:
  *     Removes a device reference from a brgy account if present.
  * Inputs:
  *     brgyUsername: brgy account username
  *     streamId:     device streamId
  * Outputs obj.str:
  *     "brgyNotFound":     if brgy account missing
  *     "deviceNotFound":   if device not found
  *     "deviceNotLinked":  if device not in brgy.devices
  *     "success":          on removal
  ***************************************************************************/
exports.removeDeviceFromBrgyByStreamId = async (brgyUsername, streamId) => {
  const brgy = await User.findOne({ username: brgyUsername, roles: 'brgy' });
  if (!brgy) {
    return { str: 'brgyNotFound' };
  }

  const device = await Device.findOne({ streamId });
  if (!device) {
    return { str: 'deviceNotFound' };
  }

  const hasDevice = brgy.devices.some((devId) => devId.toString() === device.id);
  if (!hasDevice) {
    return { str: 'deviceNotLinked' };
  }

  brgy.devices.pull(device._id);
  await brgy.save();
  return { str: 'success' };
};

/**
 * Returns brgy accounts that reference a device by streamId.
 */
exports.getBrgyAccountsWithDevice = async (streamId) => {
  const device = await Device.findOne({ streamId });
  if (!device) return [];
  const matches = await User.find({
    roles: 'brgy',
    devices: device._id,
  }, 'username');
  return matches || [];
};

/***************************************************************************
  * removeSensorDeviceFromBrgy:
  *     Removes a device (by streamId) from a brgy account's devices list,
  *     ensuring the device belongs to the requesting sensor.
  * Inputs:
  *     sensorUsername: username from the sensor's JWT
  *     brgyUsername:   target brgy account username
  *     streamId:       streamId of the device to remove
  * Outputs obj.str:
  *     "sensorNotFound":        if the sensor account is missing
  *     "brgyNotFound":          if the brgy account is missing or not a brgy
  *     "deviceNotFound":        if the streamId is not in Devices collection
  *     "deviceNotOwnedBySensor":if the device does not belong to the sensor
  *     "deviceNotLinkedToBrgy": if the brgy does not list this device
  *     "success":               when the device reference is removed
  *     
 ***************************************************************************/
exports.removeSensorDeviceFromBrgy = async (sensorUsername, brgyUsername, streamId) => {
  const sensor = await User.findOne({ username: sensorUsername }).populate('devices');
  if (!sensor) {
    return { str: 'sensorNotFound' };
  }

  const brgy = await User.findOne({ username: brgyUsername, roles: 'brgy' });
  if (!brgy) {
    return { str: 'brgyNotFound' };
  }

  const device = await Device.findOne({ streamId });
  if (!device) {
    return { str: 'deviceNotFound' };
  }

  const sensorOwnsDevice = sensor.devices.some((dev) => dev.id === device.id);
  if (!sensorOwnsDevice) {
    return { str: 'deviceNotOwnedBySensor' };
  }

  const alreadyLinkedToBrgy = brgy.devices.some((devId) => devId.toString() === device.id);
  if (!alreadyLinkedToBrgy) {
    return { str: 'deviceNotLinkedToBrgy' };
  }

  brgy.devices.pull(device._id);
  await brgy.save();

  return { str: 'success' };
};


/***************************************************************************
  * getAccountProfile:
  *     Gets profile information for the account of 'username'
  * Inputs:
  *     username: citizen username of the account
  * Outputs obj.str:
  *     "accountNotExists": if username doesn't exist in DB
  *     "success":          if username is registered in DB
  * Outputs obj.profile:
  *     Will contain profile info based on ccount
  *     {username, email}
  *     
 ***************************************************************************/
exports.getAccountProfile = async (username) => {
    const citizen = await User.findOne({ 'username': username });

    if (!citizen) { // User is not found in database
      return {str: 'accountNotExists'};
    }
    
  return {
    str: 'success',
      profile: {
        username: citizen.username,
        email: citizen.email,
        roles: citizen.roles || [],
        passwordPolicyVersion: citizen.passwordPolicyVersion || LEGACY_PASSWORD_POLICY_VERSION,
        passwordUpdatedAt: citizen.passwordUpdatedAt,
      }
    }
}

/**
 * Update account email and/or password for a logged-in user.
 * @param {string} username
 * @param {Object} updates
 * @param {string} [updates.email] New email address
 * @param {string} [updates.newPassword] New password (validated)
 * @param {string} updates.currentPassword Current password for verification
 * @returns {Promise<Object>} outcome descriptor
 */
exports.updateAccountProfile = async (username, { email, newPassword, currentPassword }) => {
  const account = await User.findOne({ username });
  if (!account) {
    return { str: 'accountNotExists' };
  }

  const hasEmailChange = Boolean(email) && email !== account.email;
  const hasPasswordChange = Boolean(newPassword);
  if (!hasEmailChange && !hasPasswordChange) {
    return { str: 'noChanges' };
  }

  if (!currentPassword || !bcrypt.compareSync(currentPassword, account.password)) {
    return { str: 'wrongPassword' };
  }

  if (hasEmailChange) {
    const existing = await User.findOne({ email });
    if (existing && existing.username !== username) {
      return { str: 'emailExists' };
    }
    account.email = email;
  }

  if (hasPasswordChange) {
    const validation = passwordSchema('New password').validate(newPassword);
    if (validation.error) {
      return { str: 'invalidPassword', message: validation.error.message };
    }
    account.password = bcrypt.hashSync(newPassword, 10);
    account.passwordPolicyVersion = CURRENT_PASSWORD_POLICY_VERSION;
    account.passwordUpdatedAt = new Date();
  }

  await account.save();

  return {
    str: 'success',
    updated: {
      email: hasEmailChange,
      password: hasPasswordChange,
    },
    passwordStatus:
      (account.passwordPolicyVersion || LEGACY_PASSWORD_POLICY_VERSION) >= CURRENT_PASSWORD_POLICY_VERSION
        ? 'current'
        : 'legacy',
    passwordPolicyVersion: account.passwordPolicyVersion,
  };
};


/***************************************************************************
  * getActiveRingserverHosts:
  *     Gets list of registered brgy in the network
  * Inputs:
  *     none
  * Outputs obj.str:
  *     "noRingserverHostExists":   if no account with `brgy` role exists in DB
  *     "success":                  if there is at least one registered brgy account in DB
  * Outputs obj.hosts:
  *     Will contain array of objects of registered brgy ringserver hosts
  *     [{username: usernameStr, ringserverUrl: urlStr, ringserverPort: portNum}]
  *     
 ***************************************************************************/
exports.getActiveRingserverHosts = async () => {
  const ringserverHosts = await User.find({
    'roles': 'brgy',   // query all accounts with `brgy` role
    'isApproved': true, // get only accounts that are approved
  }, 
    'username ringserverUrl ringserverPort -_id'  // output the `username`, `ringserverUrl`, and `ringserverPort` but w/o id
  );

  if (!ringserverHosts) { // No registered brgy in DB
    return {str: 'accountNotExists'};
  }
  
  return {
    str: 'success',
    hosts: ringserverHosts
  }
}

/***************************************************************************
  * createPasswordResetToken:
  *     Generates a short-lived reset token for an account email.
  * Inputs:
  *     email: valid email string
  * Outputs obj.str:
  *     "queued":           request accepted (email existence not disclosed)
  * Outputs obj.token (optional):
  *     reset JWT if account exists
  *     
 ***************************************************************************/
exports.createPasswordResetToken = async (email) => {
  const user = await User.findOne({ email });
  if (!user) {
    return { str: 'queued', issued: false };
  }

  const secret = process.env.PASSWORD_RESET_TOKEN_KEY || process.env.ACCESS_TOKEN_PRIVATE_KEY;
  const expiresIn = process.env.PASSWORD_RESET_TOKEN_EXPIRY || '30m';
  const token = jwt.sign(
    {
      username: user.username,
      email: user.email,
      roles: user.roles || [],
    },
    secret,
    { expiresIn }
  );

  return {
    str: 'queued',
    issued: true,
    token,
    username: user.username,
    email: user.email,
  };
};

/***************************************************************************
  * applyPasswordReset:
  *     Validates reset token and updates password.
  * Inputs:
  *     token: reset token
  *     newPassword: validated new password string
  * Outputs obj.str:
  *     "invalid":          invalid token
  *     "expired":          expired token
  *     "accountNotExists": token valid but account missing
  *     "success":          password updated
  *     
 ***************************************************************************/
exports.applyPasswordReset = async (token, newPassword) => {
  const secret = process.env.PASSWORD_RESET_TOKEN_KEY || process.env.ACCESS_TOKEN_PRIVATE_KEY;

  try {
    const decoded = jwt.verify(token, secret);
    const account = await User.findOne({ email: decoded.email, username: decoded.username });
    if (!account) {
      return { str: 'accountNotExists' };
    }

    const validation = passwordSchema('New password').validate(newPassword);
    if (validation.error) {
      return { str: 'invalidPassword', message: validation.error.message };
    }

    account.password = bcrypt.hashSync(newPassword, 10);
    account.passwordPolicyVersion = CURRENT_PASSWORD_POLICY_VERSION;
    account.passwordUpdatedAt = new Date();
    await account.save();

    return { str: 'success', username: account.username };
  } catch (err) {
    if (err?.name === 'TokenExpiredError') return { str: 'expired' };
    return { str: 'invalid' };
  }
};
