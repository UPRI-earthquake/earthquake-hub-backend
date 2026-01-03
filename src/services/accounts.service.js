const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/account.model');
const Device = require('../models/device.model');
const {
  passwordSchema,
  usernameSchema,
  CURRENT_PASSWORD_POLICY_VERSION,
  LEGACY_PASSWORD_POLICY_VERSION,
  getPasswordResetSecret,
  getAccessTokenSecret,
} = require('../controllers/helpers');
const EmailService = require('./email.service');

const PASSWORD_RESET_TOKEN_EXPIRY = process.env.PASSWORD_RESET_TOKEN_EXPIRY || '30m';
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normalizeEmail = (value = '') => String(value || '').trim().toLowerCase();
const buildEmailQuery = (email) => ({ email: new RegExp(`^${escapeRegex(email)}$`, 'i') });

function hashTokenId(tokenId) {
  return crypto.createHash('sha256').update(String(tokenId || '')).digest('hex');
}

function buildResetLink(token) {
  const normalizeBase = (value, proto) => {
    if (!value) return null;
    if (/^https?:\/\//i.test(value)) return value.replace(/\/+$/, '');
    return `${proto}://${String(value).replace(/\/+$/, '')}`;
  };
  const devHost = process.env.CLIENT_DEV_PORT
    ? `${process.env.CLIENT_DEV_HOST}:${process.env.CLIENT_DEV_PORT}`
    : process.env.CLIENT_DEV_HOST;
  const base =
    process.env.NODE_ENV === 'production'
      ? normalizeBase(process.env.CLIENT_PROD_HOST, 'https')
      : normalizeBase(devHost, 'http');
  if (!base) return null;
  return `${base}/reset-password?token=${encodeURIComponent(token)}`;
}

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
  const normalizedUsername = (username || '').trim();
  const normalizedEmail = normalizeEmail(email);

  // Check if username is in use
  if (await User.findOne({ username: normalizedUsername })) {
    return 'usernameExists';
  }

  // Check if email is in use
  if (await User.findOne(buildEmailQuery(normalizedEmail))) {
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
        username: normalizedUsername,
        email: normalizedEmail,
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
        username: normalizedUsername,
        email: normalizedEmail,
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
  *     Compares provided identifier/password & role with that in DB
  * Inputs:
  *     identifier: username or contact email string
  *     password: valid password string
  * Outputs:
  *     "accountNotExists":    if username doesn't exist in DB
  *     "wrongPassword":       if password does NOT match username's password in DB
  *     "invalidCredentials":  if identifier/password combo fails with masked errors
  *     "invalidRole":         if claimed role is listed as user's role in DB
  *     "successSensorBrgy":   if Sensor/Brgy password matches their password in DB,
  *                            and they have linked devices
  *     "successCitizen":      if Citizen's password matches their's password in DB
  *     "brgyAccountInactive": if Brgy is registered but not yet approved by admin
  *     
 ***************************************************************************/
exports.loginAccountRole = async (identifier, password, role, options = {}) => {
  const { maskUserNotFound = false } = options;
  const trimmedIdentifier = (identifier || '').trim();
  const lookupByEmail = EMAIL_REGEX.test(trimmedIdentifier);

  const user = await User.findOne(
    lookupByEmail ? buildEmailQuery(normalizeEmail(trimmedIdentifier)) : { username: trimmedIdentifier }
  ).populate('devices');

  if(!user){
    return maskUserNotFound ? 'invalidCredentials' : 'accountNotExists';
  }

  const username = user.username;

  // get user with its devices array populated by device object (instead of device id)
  // compare received password with user's password in db
  let passwordIsValid = bcrypt.compareSync(
    password,      // received password
    user.password  // password in db
  )

  if(!passwordIsValid){
    return maskUserNotFound ? 'invalidCredentials' : 'wrongPassword';
  }

  // check if claimed role reflects allowed role in db
  if(!user.roles.includes(role)){
    return maskUserNotFound ? 'invalidCredentials' : 'invalidRole';
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
      return {
        str: 'successSensorBrgy',
        username,
        passwordStatus,
        passwordPolicyVersion: updatedPolicyVersion,
      };
    case 'brgy':
      // check if brgy account is approved
      if (!user.isApproved) {
        return 'brgyAccountInactive';
      }
      return {
        str: 'successSensorBrgy',
        username,
        passwordStatus,
        passwordPolicyVersion: updatedPolicyVersion,
      };
    case 'citizen':
      return {
        str: 'successCitizen',
        username,
        passwordStatus,
        passwordPolicyVersion: updatedPolicyVersion,
      };
  }
  return { str: "success", username, passwordStatus, passwordPolicyVersion: updatedPolicyVersion };
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
    jwt.verify(token, getAccessTokenSecret('device'), async (err, decodedToken) => {
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

  const normalizedEmail = email ? normalizeEmail(email) : null;
  const hasEmailChange =
    Boolean(normalizedEmail) && normalizedEmail !== normalizeEmail(account.email || '');
  const hasPasswordChange = Boolean(newPassword);
  if (!hasEmailChange && !hasPasswordChange) {
    return { str: 'noChanges' };
  }

  if (!currentPassword || !bcrypt.compareSync(currentPassword, account.password)) {
    return { str: 'wrongPassword' };
  }

  if (hasEmailChange) {
    const existing = await User.findOne(buildEmailQuery(normalizedEmail));
    if (existing && existing.username !== username) {
      return { str: 'emailExists' };
    }
    account.email = normalizedEmail;
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

/**
 * Update contact email for a logged-in user.
 * @param {string} username
 * @param {Object} updates
 * @param {string} updates.email New email
 * @param {string} updates.currentPassword Current password for verification
 * @returns {Promise<Object>} outcome descriptor
 */
exports.updateAccountEmail = async (username, { email, currentPassword }) => {
  const account = await User.findOne({ username });
  if (!account) {
    return { str: 'accountNotExists' };
  }

  const normalizedEmail = email ? normalizeEmail(email) : null;
  if (!normalizedEmail || normalizedEmail === normalizeEmail(account.email || '')) {
    return { str: 'noChanges' };
  }

  if (!currentPassword || !bcrypt.compareSync(currentPassword, account.password)) {
    return { str: 'wrongPassword' };
  }

  const existing = await User.findOne(buildEmailQuery(normalizedEmail));
  if (existing && existing.username !== username) {
    return { str: 'emailExists' };
  }

  account.email = normalizedEmail;
  await account.save();

  return {
    str: 'success',
    updated: { email: true },
  };
};

/**
 * Update password for a logged-in user.
 * @param {string} username
 * @param {Object} updates
 * @param {string} updates.currentPassword Current password for verification
 * @param {string} updates.newPassword New password
 * @returns {Promise<Object>} outcome descriptor
 */
exports.updateAccountPassword = async (username, { currentPassword, newPassword }) => {
  const account = await User.findOne({ username });
  if (!account) {
    return { str: 'accountNotExists' };
  }

  if (!newPassword) {
    return { str: 'noChanges' };
  }

  if (!currentPassword || !bcrypt.compareSync(currentPassword, account.password)) {
    return { str: 'wrongPassword' };
  }

  const validation = passwordSchema('New password').validate(newPassword);
  if (validation.error) {
    return { str: 'invalidPassword', message: validation.error.message };
  }

  account.password = bcrypt.hashSync(newPassword, 10);
  account.passwordPolicyVersion = CURRENT_PASSWORD_POLICY_VERSION;
  account.passwordUpdatedAt = new Date();

  await account.save();

  return {
    str: 'success',
    updated: { password: true },
    passwordStatus:
      (account.passwordPolicyVersion || LEGACY_PASSWORD_POLICY_VERSION) >= CURRENT_PASSWORD_POLICY_VERSION
        ? 'current'
        : 'legacy',
    passwordPolicyVersion: account.passwordPolicyVersion,
  };
};

/**
 * Update username for a logged-in user and cascade username-derived metadata.
 * @param {string} currentUsername
 * @param {Object} updates
 * @param {string} updates.newUsername Requested new username
 * @param {string} updates.currentPassword Current password for verification
 * @returns {Promise<Object>} outcome descriptor
 */
exports.updateAccountUsername = async (currentUsername, { newUsername, currentPassword }) => {
  const account = await User.findOne({ username: currentUsername });
  if (!account) {
    return { str: 'accountNotExists' };
  }

  const nextUsername = (newUsername || '').trim();
  if (!nextUsername || nextUsername === currentUsername) {
    return { str: 'noChanges' };
  }

  const validation = usernameSchema('New username').validate(nextUsername);
  if (validation.error) {
    return { str: 'invalidUsername', message: validation.error.message };
  }

  if (!currentPassword || !bcrypt.compareSync(currentPassword, account.password)) {
    return { str: 'wrongPassword' };
  }

  const existing = await User.findOne({ username: nextUsername });
  if (existing && existing.id !== account.id) {
    return { str: 'usernameExists' };
  }

  const deviceIds = (account.devices || []).filter(Boolean).map((d) => d._id || d);
  const newDescription = `${nextUsername}'s device`;

  const applyUpdates = async (session = null) => {
    const accountToUpdate = session
      ? await User.findById(account._id).session(session)
      : await User.findById(account._id);
    if (!accountToUpdate) {
      throw new Error('accountMissingDuringUpdate');
    }
    accountToUpdate.username = nextUsername;
    await accountToUpdate.save({ session });

    if (deviceIds.length > 0) {
      const updateResult = await Device.updateMany(
        { _id: { $in: deviceIds } },
        { $set: { description: newDescription } },
        { session }
      );
      return updateResult?.modifiedCount || updateResult?.nModified || 0;
    }
    return 0;
  };

  let updatedDevices = 0;
  let usedTransaction = false;
  let session = null;

  try {
    session = await User.startSession();
    await session.withTransaction(async () => {
      updatedDevices = await applyUpdates(session);
    });
    usedTransaction = true;
  } catch (err) {
    const message = String(err?.message || '').toLowerCase();
    const transactionUnsupported =
      message.includes('replica set') || message.includes('transactions are not supported');
    if (!transactionUnsupported) {
      throw err;
    }
  } finally {
    if (session) {
      await session.endSession();
    }
  }

  if (!usedTransaction) {
    try {
      updatedDevices = await applyUpdates(null);
    } catch (err) {
      await User.updateOne(
        { _id: account._id },
        { $set: { username: currentUsername } }
      ).catch(() => {});
      throw err;
    }
  }

  return {
    str: 'success',
    username: nextUsername,
    updatedDevices,
  };
};

/***************************************************************************
  * deleteAccount:
  *     Deletes an account that has no device associations.
  * Inputs:
  *     username: account username
  * Outputs obj.str:
  *     "accountNotExists": if username not found
  *     "hasDevices":       if account still has device references
  *     "success":          when account is removed
  ***************************************************************************/
exports.deleteAccount = async (username) => {
  const account = await User.findOne({ username });
  if (!account) {
    return { str: 'accountNotExists' };
  }

  const deviceCount = (account.devices || []).filter(Boolean).length;
  if (deviceCount > 0) {
    return { str: 'hasDevices', deviceCount };
  }

  await User.deleteOne({ _id: account._id });
  return { str: 'success' };
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
  const normalizedEmail = normalizeEmail(email);
  const user = await User.findOne(buildEmailQuery(normalizedEmail));
  if (!user) {
    return { str: 'queued', issued: false };
  }

  const secret = getPasswordResetSecret();
  const tokenId = crypto.randomBytes(24).toString('hex');
  const token = jwt.sign(
    {
      username: user.username,
      email: user.email,
      roles: user.roles || [],
      purpose: 'password-reset',
      jti: tokenId,
    },
    secret,
    { expiresIn: PASSWORD_RESET_TOKEN_EXPIRY }
  );

  user.passwordResetTokenId = hashTokenId(tokenId);
  user.passwordResetIssuedAt = new Date();
  user.passwordResetUsedAt = null;
  await user.save();

  const resetUrl = buildResetLink(token);
  if (resetUrl) {
    try {
      await EmailService.sendMail({
        to: user.email,
        subject: 'Reset your UPRI Earthquake Hub password',
        text: [
          'We received a request to reset your UPRI Earthquake Hub password.',
          'If you did not request this, you can ignore this message.',
          '',
          `Reset link: ${resetUrl}`,
          `This link expires in ${PASSWORD_RESET_TOKEN_EXPIRY}.`,
        ].join('\n'),
        html: `
          <p>We received a request to reset your UPRI Earthquake Hub password.</p>
          <p>If you did not request this, you can safely ignore this email.</p>
          <p><a href="${resetUrl}">Reset your password</a></p>
          <p style="color:#444;">This link expires in ${PASSWORD_RESET_TOKEN_EXPIRY}.</p>
        `,
      });
    } catch (err) {
      console.error('Password reset email delivery failed:', err?.message || err);
    }
  }

  return {
    str: 'queued',
    issued: true,
    token,
    username: user.username,
    email: user.email,
    resetUrl,
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
  const secret = getPasswordResetSecret();

  try {
    const decoded = jwt.verify(token, secret);
    const account = await User.findOne({
      username: decoded.username,
      ...buildEmailQuery(decoded.email),
    });
    if (!account) {
      return { str: 'accountNotExists' };
    }

    if (!decoded?.jti || !account.passwordResetTokenId || !account.passwordResetIssuedAt) {
      return { str: 'invalid' };
    }

    if (account.passwordResetUsedAt) {
      return { str: 'invalid' };
    }

    const hashedTokenId = hashTokenId(decoded.jti);
    if (hashedTokenId !== account.passwordResetTokenId) {
      return { str: 'invalid' };
    }

    if (decoded.purpose && decoded.purpose !== 'password-reset') {
      return { str: 'invalid' };
    }

    const validation = passwordSchema('New password').validate(newPassword);
    if (validation.error) {
      return { str: 'invalidPassword', message: validation.error.message };
    }

    account.password = bcrypt.hashSync(newPassword, 10);
    account.passwordPolicyVersion = CURRENT_PASSWORD_POLICY_VERSION;
    account.passwordUpdatedAt = new Date();
    account.passwordResetTokenId = undefined;
    account.passwordResetIssuedAt = null;
    account.passwordResetUsedAt = new Date();
    await account.save();

    return { str: 'success', username: account.username };
  } catch (err) {
    if (err?.name === 'TokenExpiredError') return { str: 'expired' };
    return { str: 'invalid' };
  }
};
