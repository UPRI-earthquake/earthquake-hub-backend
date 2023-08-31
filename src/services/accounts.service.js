const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/account.model');

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
      });
      break;
  
    case 'citizen':
      newAccount = new User({
        username: username,
        email: email,
        password: hashedPassword,
        roles: ["citizen", "sensor"] // TODO: Make this an attribute to POST route too
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
  *     "noLinkedDevice":      if Sensor/Brgy has no linked device
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

  switch(role) {
    case 'sensor':
      return 'successSensorBrgy'
    case 'brgy':
      // check if sensor account has devices OR,
      // check if brgy account has devices (of their own, or that forwards to them)
      // that they can in turn forward to UP (main receiver)
      if (!user.isApproved) {
        return 'brgyAccountInactive';
      }
      return 'successSensorBrgy'
    case 'citizen':
      return 'successCitizen'
  }
  return "success";
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
  *     {username, role, streamIds, exp}
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
        role: citizen.role
      }
    }
}


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
