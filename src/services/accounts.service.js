const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const AccountsRepo = require('../repositories/accounts.repo');
const DevicesRepo = require('../repositories/devices.repo');
const { DuplicateKeyError } = require('../repositories/errors');
const { withTransaction, isTransactionUnsupported } = require('../repositories/transactions');
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

const normalizeEmail = (value = '') => String(value || '').trim().toLowerCase();

// Maps a unique-rule violation to the matching "...Exists" result, or null if it isn't one.
// The pre-save checks below give friendly errors in the common case; this covers two requests racing.
const duplicateKeyResult = (err) => {
  if (!(err instanceof DuplicateKeyError)) return null;
  const { fields } = err;
  if (fields.includes('email')) return 'emailExists';
  if (fields.includes('username')) return 'usernameExists';
  if (fields.includes('ringserverUrl')) return 'ringserverUrlExists';
  return null;
};

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

function buildPasswordResetEmailLayout(resetUrl) {
  return {
    preheader: 'Reset your UPRI Earthquake Hub password',
    eyebrow: 'Account Security',
    badge: 'Action Required',
    title: 'Reset your password',
    lead: 'We received a request to reset your UPRI Earthquake Hub password.',
    paragraphs: [
      'Use the secure button below to set a new password.',
      'If you did not request this reset, you can safely ignore this email.',
    ],
    details: [
      { label: 'Reset Link Expiry', value: PASSWORD_RESET_TOKEN_EXPIRY },
    ],
    ctaLabel: 'Reset Password',
    ctaUrl: resetUrl,
    footer:
      `For your security, this reset link expires in ${PASSWORD_RESET_TOKEN_EXPIRY}.`,
  };
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
  if (await AccountsRepo.findByUsername(normalizedUsername)) {
    return 'usernameExists';
  }

  // Check if email is in use
  if (await AccountsRepo.findByEmail(normalizedEmail)) {
    return 'emailExists';
  }

  // save inputs to database
  const hashedPassword = bcrypt.hashSync(password, 10); // hash the password before saving to database
  let newAccount = null; // fields of the account to create

  switch (role) {
    case 'brgy':
      // Check if ringserverUrl is in use
      if (await AccountsRepo.findByRingserverUrl(ringserverUrl)) {
        return 'ringserverUrlExists';
      }

      newAccount = {
        username: normalizedUsername,
        email: normalizedEmail,
        password: hashedPassword,
        roles: ["brgy"], // TODO: Make this an attribute to POST route too
        ringserverUrl: ringserverUrl,
        ringserverPort: ringserverPort,
        passwordPolicyVersion: CURRENT_PASSWORD_POLICY_VERSION,
        passwordUpdatedAt: new Date(),
      };
      break;
  
    case 'citizen':
      newAccount = {
        username: normalizedUsername,
        email: normalizedEmail,
        password: hashedPassword,
        roles: ["citizen", "sensor"], // TODO: Make this an attribute to POST route too
        passwordPolicyVersion: CURRENT_PASSWORD_POLICY_VERSION,
        passwordUpdatedAt: new Date(),
      };
      break;
  }

  try {
    await AccountsRepo.create(newAccount);
  } catch (err) {
    const duplicate = duplicateKeyResult(err);
    if (duplicate) return duplicate;
    throw err;
  }

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

  const user = lookupByEmail
    ? await AccountsRepo.findByEmail(normalizeEmail(trimmedIdentifier))
    : await AccountsRepo.findByUsername(trimmedIdentifier);

  if(!user){
    return maskUserNotFound ? 'invalidCredentials' : 'accountNotExists';
  }

  const username = user.username;
  // MongoDB-style id: comments and contributions still store account ids as ObjectIds (until Step 4)
  const accountId = user.legacyId;

  // compare received password with user's password in db
  let passwordIsValid = bcrypt.compareSync(
    password,      // received password
    user.password  // password in db
  );

  if(!passwordIsValid){
    return maskUserNotFound ? 'invalidCredentials' : 'wrongPassword';
  }

  // check if claimed role reflects allowed role in db
  if(!user.roles.includes(role)){
    // Return the specific role error so the UI can surface an accurate cause
    return 'invalidRole';
  }

  // Track whether the provided password meets the current policy without blocking legacy users
  const passwordValidation = passwordSchema('Password').validate(password);
  const meetsCurrentPolicy = !passwordValidation.error;
  const currentPolicyVersion = user.passwordPolicyVersion || LEGACY_PASSWORD_POLICY_VERSION;
  let updatedPolicyVersion = currentPolicyVersion;
  if (meetsCurrentPolicy && currentPolicyVersion !== CURRENT_PASSWORD_POLICY_VERSION) {
    updatedPolicyVersion = CURRENT_PASSWORD_POLICY_VERSION;
    await AccountsRepo.update(user.id, {
      passwordPolicyVersion: CURRENT_PASSWORD_POLICY_VERSION,
      passwordUpdatedAt: new Date(),
    });
  } else if (!user.passwordPolicyVersion) {
    await AccountsRepo.update(user.id, { passwordPolicyVersion: LEGACY_PASSWORD_POLICY_VERSION });
  }

  const passwordStatus = (updatedPolicyVersion >= CURRENT_PASSWORD_POLICY_VERSION && meetsCurrentPolicy)
    ? 'current'
    : 'legacy';
  const rshakeEmailEnabled = Boolean(user.alertPreferences?.rshakeEmailEnabled);

  switch(role) {
    case 'sensor':
      return {
        str: 'successSensorBrgy',
        username,
        passwordStatus,
        passwordPolicyVersion: updatedPolicyVersion,
        rshakeEmailEnabled,
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
        rshakeEmailEnabled,
      };
    case 'citizen':
      return {
        str: 'successCitizen',
        accountId,
        username,
        passwordStatus,
        passwordPolicyVersion: updatedPolicyVersion,
        rshakeEmailEnabled,
      };
  }
  return {
    str: "success",
    username,
    passwordStatus,
    passwordPolicyVersion: updatedPolicyVersion,
    rshakeEmailEnabled,
  };
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
        if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
          return resolve({ str: err.name });
        }
        return reject(err);
      }

      try {
        // NOTE: A brgy can also act as a sender to UP ringserver...
        if (!(decodedToken?.role === 'sensor' || decodedToken?.role === 'brgy')) {
          return resolve({ str: 'tokenRoleInvalid' });
        }

        // Get streamIds (will be sent as response) and ids (used to update brgy table) of sensor
        const sensor = await AccountsRepo.findByUsername(decodedToken.username);
        if (!sensor) {
          return resolve({ str: 'tokenRoleInvalid' });
        }

        const sensorDevices = await DevicesRepo.listAccountDevices(sensor.id);
        const sensorStreamIds = sensorDevices.map((device) => device.streamId);
        const sensorDeviceIds = sensorDevices.map((device) => device.id);

        // Update device list of brgy to include this sensor (so that UP server, which can
        // be seen as also a brgy, will allow this brgy to forward sensor's data)
        // NOTE: That this would look like the new devices are also under/belongs-to the brgy account
        const brgy = await AccountsRepo.findByUsername(brgyUsername);  // brgy account, username is on req.username due to verifyTokenRole middleware
        if (!brgy) {
          console.log('Brgy account is valid but not found in DB!!');
          return resolve({ str: 'brgyNotFound' });
        }

        // Add sensorDeviceIds to brgy table
        const brgyDeviceIds = new Set(await DevicesRepo.listAccountDeviceIds(brgy.id));
        const newDeviceIds = sensorDeviceIds.filter((deviceId) => !brgyDeviceIds.has(deviceId));
        if (newDeviceIds.length > 0) {
          await DevicesRepo.addToAccount(brgy.id, newDeviceIds);
        }

        return resolve({
          str: 'sensorIsValid',
          sensor: {
            username: decodedToken.username,
            role: decodedToken.role,
            streamIds: sensorStreamIds,
            tokenExp: decodedToken.exp,
          },
        });
      } catch (callbackError) {
        return reject(callbackError);
      }
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
  const brgy = await AccountsRepo.findByUsername(brgyUsername, { role: 'brgy' });
  if (!brgy) {
    return { str: 'brgyNotFound' };
  }

  const device = await DevicesRepo.findByStreamId(streamId);
  if (!device) {
    return { str: 'deviceNotFound' };
  }

  if (!(await DevicesRepo.accountHasDevice(brgy.id, device.id))) {
    return { str: 'deviceNotLinked' };
  }

  await DevicesRepo.removeFromAccount(brgy.id, device.id);
  return { str: 'success' };
};

/**
 * Returns brgy accounts that reference a device by streamId.
 */
exports.getBrgyAccountsWithDevice = async (streamId) => {
  const device = await DevicesRepo.findByStreamId(streamId);
  if (!device) return [];
  return DevicesRepo.findAccountsListing(device.id, { role: 'brgy' });
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
  const sensor = await AccountsRepo.findByUsername(sensorUsername);
  if (!sensor) {
    return { str: 'sensorNotFound' };
  }

  const brgy = await AccountsRepo.findByUsername(brgyUsername, { role: 'brgy' });
  if (!brgy) {
    return { str: 'brgyNotFound' };
  }

  const device = await DevicesRepo.findByStreamId(streamId);
  if (!device) {
    return { str: 'deviceNotFound' };
  }

  const sensorDevices = await DevicesRepo.listAccountDevices(sensor.id);
  if (!sensorDevices.some((dev) => dev.id === device.id)) {
    return { str: 'deviceNotOwnedBySensor' };
  }

  if (!(await DevicesRepo.accountHasDevice(brgy.id, device.id))) {
    return { str: 'deviceNotLinkedToBrgy' };
  }

  await DevicesRepo.removeFromAccount(brgy.id, device.id);

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
    const citizen = await AccountsRepo.findByUsername(username);

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
        alertPreferences: {
          rshakeEmailEnabled: Boolean(citizen.alertPreferences?.rshakeEmailEnabled),
          updatedAt: citizen.alertPreferences?.updatedAt || null,
        },
      }
    }
}

/**
 * Update alert preferences for a logged-in user.
 * @param {string} username
 * @param {Object} updates
 * @param {boolean} updates.rshakeEmailEnabled Whether device alert emails are enabled.
 * @returns {Promise<Object>} outcome descriptor
 */
exports.updateAlertPreferences = async (username, { rshakeEmailEnabled }) => {
  const account = await AccountsRepo.findByUsername(username);
  if (!account) {
    return { str: 'accountNotExists' };
  }

  const nextValue = Boolean(rshakeEmailEnabled);
  const currentValue = Boolean(account.alertPreferences?.rshakeEmailEnabled);
  if (currentValue === nextValue) {
    return {
      str: 'noChanges',
      alertPreferences: {
        rshakeEmailEnabled: currentValue,
        updatedAt: account.alertPreferences?.updatedAt || null,
      },
    };
  }

  const updated = await AccountsRepo.update(account.id, {
    alertPreferences: {
      ...(account.alertPreferences || {}),
      rshakeEmailEnabled: nextValue,
      updatedAt: new Date(),
    },
  });

  return {
    str: 'success',
    alertPreferences: {
      rshakeEmailEnabled: Boolean(updated.alertPreferences?.rshakeEmailEnabled),
      updatedAt: updated.alertPreferences?.updatedAt || null,
    },
  };
};

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
  const account = await AccountsRepo.findByUsername(username);
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

  const changes = {};
  if (hasEmailChange) {
    const existing = await AccountsRepo.findByEmail(normalizedEmail);
    if (existing && existing.username !== username) {
      return { str: 'emailExists' };
    }
    changes.email = normalizedEmail;
  }

  if (hasPasswordChange) {
    const validation = passwordSchema('New password').validate(newPassword);
    if (validation.error) {
      return { str: 'invalidPassword', message: validation.error.message };
    }
    changes.password = bcrypt.hashSync(newPassword, 10);
    changes.passwordPolicyVersion = CURRENT_PASSWORD_POLICY_VERSION;
    changes.passwordUpdatedAt = new Date();
  }

  let updated;
  try {
    updated = await AccountsRepo.update(account.id, changes);
  } catch (err) {
    const duplicate = duplicateKeyResult(err);
    if (duplicate) return { str: duplicate };
    throw err;
  }

  return {
    str: 'success',
    updated: {
      email: hasEmailChange,
      password: hasPasswordChange,
    },
    passwordStatus:
      (updated.passwordPolicyVersion || LEGACY_PASSWORD_POLICY_VERSION) >= CURRENT_PASSWORD_POLICY_VERSION
        ? 'current'
        : 'legacy',
    passwordPolicyVersion: updated.passwordPolicyVersion,
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
  const account = await AccountsRepo.findByUsername(username);
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

  const existing = await AccountsRepo.findByEmail(normalizedEmail);
  if (existing && existing.username !== username) {
    return { str: 'emailExists' };
  }

  try {
    await AccountsRepo.update(account.id, { email: normalizedEmail });
  } catch (err) {
    const duplicate = duplicateKeyResult(err);
    if (duplicate) return { str: duplicate };
    throw err;
  }

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
  const account = await AccountsRepo.findByUsername(username);
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

  const updated = await AccountsRepo.update(account.id, {
    password: bcrypt.hashSync(newPassword, 10),
    passwordPolicyVersion: CURRENT_PASSWORD_POLICY_VERSION,
    passwordUpdatedAt: new Date(),
  });

  return {
    str: 'success',
    updated: { password: true },
    passwordStatus:
      (updated.passwordPolicyVersion || LEGACY_PASSWORD_POLICY_VERSION) >= CURRENT_PASSWORD_POLICY_VERSION
        ? 'current'
        : 'legacy',
    passwordPolicyVersion: updated.passwordPolicyVersion,
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
  const account = await AccountsRepo.findByUsername(currentUsername);
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

  const existing = await AccountsRepo.findByUsername(nextUsername);
  if (existing && existing.id !== account.id) {
    return { str: 'usernameExists' };
  }

  const deviceIds = await DevicesRepo.listAccountDeviceIds(account.id);
  const newDescription = `${nextUsername}'s device`;

  const applyUpdates = async (tx = null) => {
    const renamed = await AccountsRepo.update(account.id, { username: nextUsername }, { tx });
    if (!renamed) {
      throw new Error('accountMissingDuringUpdate');
    }
    return DevicesRepo.setDescription(deviceIds, newDescription, { tx });
  };

  let updatedDevices = 0;
  let usedTransaction = false;

  try {
    updatedDevices = await withTransaction((tx) => applyUpdates(tx));
    usedTransaction = true;
  } catch (err) {
    const duplicate = duplicateKeyResult(err);
    if (duplicate) return { str: duplicate };
    if (!isTransactionUnsupported(err)) {
      throw err;
    }
  }

  if (!usedTransaction) {
    try {
      updatedDevices = await applyUpdates(null);
    } catch (err) {
      await AccountsRepo.update(account.id, { username: currentUsername }).catch(() => {});
      const duplicate = duplicateKeyResult(err);
      if (duplicate) return { str: duplicate };
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
  const account = await AccountsRepo.findByUsername(username);
  if (!account) {
    return { str: 'accountNotExists' };
  }

  const deviceCount = (await DevicesRepo.listAccountDeviceIds(account.id)).length;
  if (deviceCount > 0) {
    return { str: 'hasDevices', deviceCount };
  }

  await AccountsRepo.remove(account.id);
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
  // approved brgy accounts: `username`, `ringserverUrl` and `ringserverPort`
  const ringserverHosts = await AccountsRepo.listApprovedRingserverHosts();

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
  const user = await AccountsRepo.findByEmail(normalizedEmail);
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

  await AccountsRepo.update(user.id, {
    passwordResetTokenId: hashTokenId(tokenId),
    passwordResetIssuedAt: new Date(),
    passwordResetUsedAt: null,
  });

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
        layout: buildPasswordResetEmailLayout(resetUrl),
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
    const account = await AccountsRepo.findByUsernameAndEmail(decoded.username, normalizeEmail(decoded.email));
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

    await AccountsRepo.update(account.id, {
      password: bcrypt.hashSync(newPassword, 10),
      passwordPolicyVersion: CURRENT_PASSWORD_POLICY_VERSION,
      passwordUpdatedAt: new Date(),
      passwordResetTokenId: undefined,
      passwordResetIssuedAt: null,
      passwordResetUsedAt: new Date(),
    });

    return { str: 'success', username: account.username };
  } catch (err) {
    if (err?.name === 'TokenExpiredError') return { str: 'expired' };
    return { str: 'invalid' };
  }
};
