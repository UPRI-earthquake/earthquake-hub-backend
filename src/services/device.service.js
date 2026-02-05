const Device = require('../models/device.model');
const Account = require('../models/account.model');
const {generateAMStationCode} = require('../controllers/helpers')

async function clearReleasedEntries({ deviceId, streamId, macAddress }, session = null) {
  const pullConditions = [];
  if (deviceId) pullConditions.push({ deviceId });
  if (streamId) pullConditions.push({ streamId });
  if (macAddress) pullConditions.push({ macAddress });

  if (!pullConditions.length) return 0;

  const pullQuery = pullConditions.length === 1 ? pullConditions[0] : { $or: pullConditions };
  const filter = { releasedDevices: { $elemMatch: pullQuery } };
  const update = { $pull: { releasedDevices: pullQuery } };
  const options = session ? { session } : undefined;

  const result = await Account.updateMany(filter, update, options);
  return result?.modifiedCount || result?.nModified || 0;
}

/***************************************************************************
  * getAllDeviceLocations:
  *     Retrieves all device locations from the database.
  * 
  * Output str:
  *     "success":        status str if device locations were successfully retrieved.
  *     "noDevicesFound": status str if no devices were found in the database.
  * 
  * Returns:
  *     An object with the following structure:
  *     {
  *         str: string,      // Status indicator ("success" or "noDevicesFound").
  *         devices: Array    // An array of device objects containing location information.
  *                           // Each device object has the following properties:
  *                           //   - network: string (name of the network to which the device belongs).
  *                           //   - code: string (device station code).
  *                           //   - latitude: number (device latitude coordinate).
  *                           //   - longitude: number (device longitude coordinate).
  *                           //   - description: string (device description).
  *     }
  * 
  * Note:
  *     - This function is asynchronous and returns a Promise that resolves to the output object.
  *     - If no devices are found in the database, the function will return a status of "noDevicesFound"
  *       along with an empty array of devices.
 ***************************************************************************/
exports.getAllDeviceLocations = async () => {
  const allDevices = await Device.find();

  if( ! allDevices){
    return {str: 'noDevicesFound'};
  }

  const devices = allDevices.map(device => ({
    network: device.network,
    code: device.station,
    latitude: device.latitude,
    longitude: device.longitude,
    activity: device.activity,
    description: device.description
  }));

  return {
    str: 'success', 
    devices: devices
  }
}

/***************************************************************************
  * getAccountDevices:
  *     Retrieves the devices associated with a given username from the database.
  * 
  * Inputs:
  *     username: string       // The username for which to retrieve the associated devices.
  * 
  * Output str:
  *     "success":            status sr if devices were successfully retrieved and associated with the username.
  *     "usernameNotFound":   status str if the provided username does not exist in the database.
  * 
  * Returns:
  *     An object with the following structure:
  *     {
  *         str: string,        // Status indicator ("success" or "usernameNotFound").
  *         devices: Array      // An array of device objects containing device information.
  *                             // Each device object has the following properties:
  *                             //   - network: string (name of the network to which the device belongs).
  *                             //   - station: string (device station code).
  *                             //   - status: string (device status - "Not Yet Linked", "Not Streaming", or "Streaming").
  *                             //   - statusSince: string (UTC timestamp when the status changed to "Not Streaming" or "Streaming").
  *                             //                  If the status is "Not Yet Linked," the value will be "Not Available."
  *     }
  * 
  * Note:
  *     - This function is asynchronous and returns a Promise that resolves to the output object.
  *     - If the provided username does not exist in the database, the function will return a status of "usernameNotFound."
  *     - If no devices are associated with the username or the user has not yet linked any devices, the function will return
  *       an empty array of devices.
 ***************************************************************************/
exports.getAccountDevices = async (username) => {
  const citizen = await Account.findOne({ 'username': username }).populate('devices');
  if( ! citizen) { return {str: 'usernameNotFound'} }

  const linkedDevices = (citizen.devices || []).filter(Boolean);
  let devicePayload = [];

  if (linkedDevices.length > 0) {
    devicePayload = linkedDevices.map(device => {
      let status = '';
      let statusSince = 'Not Available';
      
      if (device.macAddress === 'TO_BE_LINKED') {
        status = 'Not Yet Linked';
      } else if (device.activity === 'unlinked') {
        status = 'Unlinked';
        statusSince = device.activityToggleTime.toUTCString();
      } else if (device.activity === 'inactive') {
        status = 'Inactive';
        statusSince = device.activityToggleTime.toUTCString();
      } else if (device.activity === 'active' || device.activity === 'streaming') {
        status = 'Streaming';
        statusSince = device.activityToggleTime.toUTCString();
      } else {
        status = 'Inactive';
        statusSince = device.activityToggleTime.toUTCString();
      }

      const deviceInfo = {
        network: device.network,
        station: device.station,
        description: device.description,
        activity: device.activity,
        status: status,
        statusSince: statusSince,
        activityToggleTime: device.activityToggleTime,
      };

      return deviceInfo;
    });
  }

  return {
    str: 'success',
    devices: devicePayload,
    releasedDevices: (citizen.releasedDevices || []).filter(Boolean).map((entry) => ({
      deviceId: entry.deviceId || entry.device || null,
      network: entry.network,
      station: entry.station,
      description: entry.description,
      streamId: entry.streamId,
      macAddress: entry.macAddress,
      releasedAt: entry.releasedAt,
      reason: entry.reason,
    })),
  };
}

/***************************************************************************
  * getDeviceStatus:
  *     Retrieves the status of a specific device from the database.
  * 
  * Inputs:
  *     network: string       // The name of the network to which the device belongs.
  *     station: string       // The station code of the device.
  * 
  * Output str:
  *     "success":            if the device status was successfully retrieved.
  *     "deviceNotFound":     if the specified device does not exist in the database.
  * 
  * Returns:
  *     An object with the following structure:
  *     {
  *         str: string,        // Status indicator ("success" or "deviceNotFound").
  *         device: Object      // An object containing device status information.
  *                             // The device object has the following properties:
  *                             //   - network: string (name of the network to which the device belongs).
  *                             //   - station: string (device station code).
  *                             //   - status: string (device status - "Not yet linked", "Not streaming", or "Streaming").
  *                             //   - statusSince: Date (Date object representing when the status changed to "Not streaming" or "Streaming").
  *                             //                  If the status is "Not yet linked," the value will be null.
  *     }
  * 
  * Note:
  *     - This function is asynchronous and returns a Promise that resolves to the output object.
  *     - If the specified device does not exist in the database, the function will return a status of "deviceNotFound."
  *     - If the device status is successfully retrieved, the function will return a status of "success"
  *       along with an object containing the device's status information (status, network, station, and statusSince).
  *     - If the device is not yet linked (macAddress is 'TO_BE_LINKED'), the status will be "Not yet linked" with a null statusSince.
 ***************************************************************************/
exports.getDeviceStatus = async (network, station) => {
  const device = await Device.findOne({ network: network, station: station });
  if( ! device) { return {str: 'deviceNotFound'} }

  let status = '';
  let statusSince = null;

  if (device.macAddress === 'TO_BE_LINKED') {
    status = 'Not Yet Linked';
  } else if (device.activity === 'unlinked') {
    status = 'Unlinked';
    statusSince = device.activityToggleTime;
  } else if (device.activity === 'inactive') {
    status = 'Inactive';
    statusSince = device.activityToggleTime;
  } else if (device.activity === 'active' || device.activity === 'streaming') {
    status = 'Streaming';
    statusSince = device.activityToggleTime;
  } else {
    status = 'Inactive';
    statusSince = device.activityToggleTime;
  }

  let deviceStatus = {
    network: device.network,
    station: device.station,
    activity: device.activity,
    status: status,
    statusSince: statusSince,
    activityToggleTime: device.activityToggleTime,
  };

  return {
    str: 'success',
    device: deviceStatus
  }
}

/***************************************************************************
  * linkDevice:
  *     Adds device record to user's device list
  * 
  * Inputs:
  *     username: string       // The username of the account to which the device will be linked.
  *     elevation: number      // The elevation value of the new device.
  *     latitude: number       // The latitude coordinate of the new device.
  *     longitude: number      // The longitude coordinate of the new device.
  *     macAddress: string     // The MAC address of the device to be linked.
  *     streamId: string       // The unique stream identifier of the device.
  * 
  * Output str:
  *     "success":                if the device was successfully added to the user account
  *     "alreadyLinked":          if a device with the specified MAC address already exists in user's device list.
  *     "alreadyLinkedToSomeone": if a device with the specified MAC address already belongs to someone else's device list
  *     "incorrectAMStation":     if an AM device doesn't follow the correct station code naming convention
  *     "usernameNotFound":       if the provided username does not exist in the database.
  * 
  * Returns:
  *     An object with the following structure:
  *     {
  *         str: string,        // Status indicator ("success", "alreadyLinked", "usernameNotFound", "deviceNotFound", or "deviceNotOwned").
  *         deviceInfo: Object  // An object containing updated device information, including network, station, longitude,
  *                             // latitude, elevation, and streamId properties.
  *     }
  * 
  * Note:
  *     - This function is asynchronous and returns a Promise that resolves to the output object.
 ***************************************************************************/
exports.linkDevice = async(username, elevation, longitude, latitude, macAddress, streamId) => {
  // check if user exists
  const currentAccount = await Account.findOne({ 'username' : username }).populate('devices');
  if(!currentAccount){
    return {str:'usernameNotFound'};
  }

  // Parse device details early
  const [network, station, loc, channel] = streamId.split(",")[0].split("_")

  // check if user already has the device in their record
  const deviceOwned = currentAccount.devices.find(device => device.macAddress === macAddress);
  if(deviceOwned){
    // If the device is marked unlinked, treat this as a relink that restores activity only.
    if (deviceOwned.activity === 'unlinked') {
      deviceOwned.description = `${username}'s device`;
      deviceOwned.network = (network || deviceOwned.network || '').toUpperCase();
      deviceOwned.station = (station || deviceOwned.station || '').toUpperCase();
      deviceOwned.elevation = elevation;
      deviceOwned.longitude = longitude;
      deviceOwned.latitude = latitude;
      deviceOwned.streamId = streamId;
      deviceOwned.activity = 'inactive';
      deviceOwned.activityToggleTime = new Date();
      await deviceOwned.save();
      await clearReleasedEntries({
        deviceId: deviceOwned._id,
        streamId,
        macAddress,
      });

      const payload = {
        deviceInfo: {
          network: deviceOwned.network,
          station: deviceOwned.station,
          longitude: deviceOwned.longitude,
          latitude: deviceOwned.latitude,
          elevation: deviceOwned.elevation,
          streamId: deviceOwned.streamId
        }
      };
      return { str: 'success', payload };
    }

    const payload = {
      deviceInfo: {
        network: deviceOwned.network,
        station: deviceOwned.station,
        longitude: deviceOwned.longitude,
        latitude: deviceOwned.latitude,
        elevation: deviceOwned.elevation,
        streamId: deviceOwned.streamId
      }
    }
    await clearReleasedEntries({
      deviceId: deviceOwned._id,
      streamId,
      macAddress,
    });
    return {str:'alreadyLinked', payload: payload};
  }

  // check if device's mac address already exists in the database
  const device = await Device.findOne({macAddress: macAddress})
  if (device) { // device is already saved to db
    const existingOwner = await Account.findOne({ devices: device._id }).select('username');

    // Preserve ownership history: only the last linked account may relink.
    if (existingOwner && existingOwner.username !== username) {
      return {str:'alreadyLinkedToSomeone'};
    }

    if (device.activity === 'unlinked') {
      // Relink existing record and refresh description/ownership.
      device.description = `${username}'s device`;
      device.network = (network || device.network || '').toUpperCase();
      device.station = (station || device.station || '').toUpperCase();
      device.elevation = elevation;
      device.longitude = longitude;
      device.latitude = latitude;
      device.streamId = streamId;
      device.activity = 'inactive';
      device.activityToggleTime = new Date();
      await device.save();

      // Backfill account association if legacy unlinking removed it.
      await currentAccount.updateOne({
        $addToSet: { devices: device._id }
      });
      await clearReleasedEntries({
        deviceId: device._id,
        streamId,
        macAddress,
      });

      const payload = {
        deviceInfo: {
          network: device.network,
          station: device.station,
          longitude: device.longitude,
          latitude: device.latitude,
          elevation: device.elevation,
          streamId: device.streamId
        }
      };
      return {str:'success', payload};
    }

    return {str:'alreadyLinkedToSomeone'};
  }

  //check mac and station if device is from AM network
  if(network === 'AM'){
    correctStationCode = generateAMStationCode(macAddress)
    if (station !== correctStationCode){
      return {str:'incorrectAMStation'};
    }
  }

  // Create new device with provided info
  const newDevice = new Device({
    description: `${username}'s device`,
    network: network.toUpperCase(),
    station: station.toUpperCase(),
    elevation: elevation,
    longitude: longitude,
    latitude: latitude,
    macAddress: macAddress,
    streamId: streamId,
    activityToggleTime: new Date(),
  });
  await newDevice.save(); // save new entry to device collections

  await currentAccount.updateOne({ // update devices array under accounts collection
    $push: { devices: newDevice._id }
  });
  await clearReleasedEntries({
    deviceId: newDevice._id,
    streamId,
    macAddress,
  });

  // Query updated device information
  const updatedDevice = await Device.findOne({ _id: newDevice._id })

  const payload = {
    deviceInfo: {
      network: updatedDevice.network,
      station: updatedDevice.station,
      longitude: updatedDevice.longitude,
      latitude: updatedDevice.latitude,
      elevation: updatedDevice.elevation,
      streamId: updatedDevice.streamId
    }
  }

  return {str:'success', payload: payload}
}

/***************************************************************************
  * unlinkDevice:
  *     Unlinks a physical device to a user account and updates the device record in the database.
  * 
  * Inputs:
  *     username: string       // The username of the account to which the device will be unlinked.
  *     macAddress: string     // The MAC address of the device for verification.
  *     streamId: string       // The unique stream identifier of the device; also used for verification.
  * 
  * Output str:
  *     "success":             if the device was successfully unlinked from the user account and device information updated.
  *     "usernameNotFound":    if the provided username does not exist in the database.
  *     "deviceNotFound":      if a device with the specified network and station is not found in the database.
  *     "deviceNotOwned":      if the specified device is not owned by the provided username.
  * 
  * Returns:
  *     An object with the following structure:
  *     {
  *         str: string,        // Status indicator ("success", "usernameNotFound", "deviceNotFound", or "deviceNotOwned").
  *     }
  * 
  * Note:
  *     - This function is asynchronous and returns a Promise that resolves to the output object.
  *     - If the device is successfully unlinked to the user account and the device information is removed in the database, the function will return
  *       "success".
 ***************************************************************************/
exports.unlinkDevice = async(username, macAddress, streamId) => {
  const user = await Account.findOne({ 'username': username }).populate('devices')
  if(!user){
    return {str:'usernameNotFound'};
  }

  // Must be an existing user account to accept device unlinking request - update db.
  // get device with same Network and Station
  const [network, station, loc, channel] = streamId.split(",")[0].split("_")
  const device = await Device.findOne({ network:network, station:station })

  if(!device){
    return {str:'deviceNotFound'};
  }

  // find the index of the device in the user.devices array
  const index = user.devices.findIndex(dev => dev.id === device.id);

  if (index === -1) {
    // device not found in the account.devices array, handle error or return null
    return {str:'deviceNotOwned'};
  }

  const releaseTimestamp = new Date();
  const releaseSnapshot = {
    deviceId: device._id,
    streamId: device.streamId,
    macAddress: device.macAddress,
    network: device.network,
    station: device.station,
    description: device.description,
    releasedAt: releaseTimestamp,
    reason: 'unlink',
  };

  const applyRelease = async (session = null) => {
    const deviceUpdate = {
      $set: {
        activity: 'unlinked',
        activityToggleTime: releaseTimestamp,
      },
    };
    const accountUpdate = {
      $pull: { devices: device._id },
      $push: { releasedDevices: releaseSnapshot },
    };

    if (session) {
      await Device.updateOne({ _id: device._id }, deviceUpdate, { session });
      await Account.updateOne({ _id: user._id }, accountUpdate, { session });
      return;
    }

    await Device.updateOne({ _id: device._id }, deviceUpdate);
    await Account.updateOne({ _id: user._id }, accountUpdate);
  };

  let session = null;
  try {
    session = await Account.startSession();
    await session.withTransaction(async () => {
      await applyRelease(session);
    });
  } catch (err) {
    const message = String(err?.message || '').toLowerCase();
    const transactionUnsupported =
      message.includes('replica set') || message.includes('transactions are not supported');
    if (!transactionUnsupported) {
      throw err;
    }
    await applyRelease();
  } finally {
    if (session) {
      await session.endSession();
    }
  }

  return {str:'success'}
}

/***************************************************************************
  * resetDeviceLink:
  *     Removes a device record entirely and detaches all account references.
  * 
  * Inputs:
  *     username:    string // Requesting user's username (from token)
  *     macAddress:  string // MAC address identifier
  *     streamId:    string // Stream ID identifier
  * 
  * Output str:
  *     "success":             when device record and associations are removed
  *     "deviceNotFound":      when no device matches the provided identifiers
  *     "identifierMismatch":  when macAddress and streamId point to different records
  *     "deviceOwnedElsewhere":when the device is linked to another account
  ***************************************************************************/
exports.resetDeviceLink = async (username, macAddress, streamId) => {
  const lookupConditions = [];
  if (macAddress) lookupConditions.push({ macAddress });
  if (streamId) lookupConditions.push({ streamId });

  if (lookupConditions.length === 0) {
    return { str: 'missingIdentifiers' };
  }

  const candidates = await Device.find({ $or: lookupConditions });
  if (!candidates || candidates.length === 0) {
    return { str: 'deviceNotFound' };
  }

  const uniqueIds = [...new Set(candidates.map((device) => device.id))];
  if (uniqueIds.length > 1) {
    return { str: 'identifierMismatch' };
  }

  const device = candidates[0];
  const linkedAccounts = await Account.find({ devices: device._id });
  const linkedUsernames = linkedAccounts.map((acc) => acc.username);
  const ownedByRequester = username && linkedUsernames.includes(username);

  // Unauthenticated resets are only allowed when no account references exist.
  // Even if activity is marked "unlinked", require auth when account links remain.
  if (!username && linkedUsernames.length > 0) {
    return { str: 'authRequired', linkedUsernames };
  }

  if (linkedUsernames.length > 0 && username && !ownedByRequester) {
    return { str: 'deviceOwnedElsewhere', linkedUsernames };
  }

  await Account.updateMany(
    { devices: device._id },
    { $pull: { devices: device._id } },
  );

  await Device.deleteOne({ _id: device._id });

  return {
    str: 'success',
    payload: {
      removedAccounts: linkedUsernames,
      ownershipConfirmed: ownedByRequester,
    },
  };
}
