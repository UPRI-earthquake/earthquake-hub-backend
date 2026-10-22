const AccountsRepo = require('../repositories/accounts.repo');
const DevicesRepo = require('../repositories/devices.repo');
const { DuplicateKeyError } = require('../repositories/errors');
const { withTransaction, isTransactionUnsupported } = require('../repositories/transactions');
const {generateAMStationCode} = require('../controllers/helpers')

// Writes a device (create or update), resolving to null instead of throwing when it collides with
// another device's identity (network+station, streamId or macAddress).
async function writeDeviceIfUnique(write) {
  try {
    return await write();
  } catch (err) {
    if (err instanceof DuplicateKeyError) return null;
    throw err;
  }
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
  // The station map needs every device, but only these fields.
  const allDevices = await DevicesRepo.listLocations();

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
  const citizen = await AccountsRepo.findByUsername(username);
  if( ! citizen) { return {str: 'usernameNotFound'} }

  const linkedDevices = await DevicesRepo.listAccountDevices(citizen.id);
  let devicePayload = [];

  if (linkedDevices.length > 0) {
    devicePayload = linkedDevices.map(device => {
      let status = '';
      let statusSince = 'Not Available';
      
      if (!device.macAddress) {
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
        longitude: device.longitude,
        latitude: device.latitude,
        elevation: device.elevation,
      };

      return deviceInfo;
    });
  }

  return {
    str: 'success',
    devices: devicePayload,
    releasedDevices: await DevicesRepo.listReleases(citizen.id),
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
  *     - If the device is not yet linked (macAddress is null), the status will be "Not yet linked" with a null statusSince.
 ***************************************************************************/
exports.getDeviceStatus = async (network, station) => {
  const device = await DevicesRepo.findByNetworkStation(network, station);
  if( ! device) { return {str: 'deviceNotFound'} }

  let status = '';
  let statusSince = null;

  if (!device.macAddress) {
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
  const currentAccount = await AccountsRepo.findByUsername(username);
  if(!currentAccount){
    return {str:'usernameNotFound'};
  }

  // Parse device details early
  const [network, station] = streamId.split(",")[0].split("_")

  // check if user already has the device in their record
  const accountDevices = await DevicesRepo.listAccountDevices(currentAccount.id);
  const deviceOwned = accountDevices.find(device => device.macAddress === macAddress);
  if(deviceOwned){
    // If the device is marked unlinked, treat this as a relink that restores activity only.
    if (deviceOwned.activity === 'unlinked') {
      const relinked = await writeDeviceIfUnique(() => DevicesRepo.update(deviceOwned.id, {
        description: `${username}'s device`,
        network: (network || deviceOwned.network || '').toUpperCase(),
        station: (station || deviceOwned.station || '').toUpperCase(),
        elevation: elevation,
        longitude: longitude,
        latitude: latitude,
        streamId: streamId,
        activity: 'inactive',
        activityToggleTime: new Date(),
      }));
      if (!relinked) {
        return { str: 'alreadyLinkedToSomeone' };
      }
      await DevicesRepo.clearReleases({
        deviceId: relinked.id,
        streamId,
        macAddress,
      });

      const payload = {
        deviceInfo: {
          network: relinked.network,
          station: relinked.station,
          longitude: relinked.longitude,
          latitude: relinked.latitude,
          elevation: relinked.elevation,
          streamId: relinked.streamId
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
    await DevicesRepo.clearReleases({
      deviceId: deviceOwned.id,
      streamId,
      macAddress,
    });
    return {str:'alreadyLinked', payload: payload};
  }

  // check if device's mac address already exists in the database
  const device = await DevicesRepo.findByMacAddress(macAddress)
  if (device) { // device is already saved to db
    const [existingOwner] = await DevicesRepo.findAccountsListing(device.id);

    // Preserve ownership history: only the last linked account may relink.
    if (existingOwner && existingOwner.username !== username) {
      return {str:'alreadyLinkedToSomeone'};
    }

    if (device.activity === 'unlinked') {
      // Relink existing record and refresh description/ownership.
      const relinked = await writeDeviceIfUnique(() => DevicesRepo.update(device.id, {
        description: `${username}'s device`,
        network: (network || device.network || '').toUpperCase(),
        station: (station || device.station || '').toUpperCase(),
        elevation: elevation,
        longitude: longitude,
        latitude: latitude,
        streamId: streamId,
        activity: 'inactive',
        activityToggleTime: new Date(),
      }));
      if (!relinked) {
        return { str: 'alreadyLinkedToSomeone' };
      }

      // Backfill account association if legacy unlinking removed it.
      await DevicesRepo.addToAccount(currentAccount.id, [relinked.id]);
      await DevicesRepo.clearReleases({
        deviceId: relinked.id,
        streamId,
        macAddress,
      });

      const payload = {
        deviceInfo: {
          network: relinked.network,
          station: relinked.station,
          longitude: relinked.longitude,
          latitude: relinked.latitude,
          elevation: relinked.elevation,
          streamId: relinked.streamId
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

  // Create new device with provided info; a collision means another record already has this station/stream/MAC
  const newDevice = await writeDeviceIfUnique(() => DevicesRepo.create({
    description: `${username}'s device`,
    network: network.toUpperCase(),
    station: station.toUpperCase(),
    elevation: elevation,
    longitude: longitude,
    latitude: latitude,
    macAddress: macAddress,
    streamId: streamId,
    activityToggleTime: new Date(),
  }));
  if (!newDevice) {
    return { str: 'alreadyLinkedToSomeone' };
  }

  await DevicesRepo.addToAccount(currentAccount.id, [newDevice.id]); // add to the account's device list
  await DevicesRepo.clearReleases({
    deviceId: newDevice.id,
    streamId,
    macAddress,
  });

  // Query updated device information
  const updatedDevice = await DevicesRepo.findById(newDevice.id)

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
  const user = await AccountsRepo.findByUsername(username)
  if(!user){
    return {str:'usernameNotFound'};
  }

  // Must be an existing user account to accept device unlinking request - update db.
  // get device with same Network and Station
  const [network, station] = streamId.split(",")[0].split("_")
  const device = await DevicesRepo.findByNetworkStation(network, station)

  if(!device){
    return {str:'deviceNotFound'};
  }

  // find the index of the device in the account's device list
  const userDevices = await DevicesRepo.listAccountDevices(user.id);
  const index = userDevices.findIndex(dev => dev.id === device.id);

  if (index === -1) {
    // device not found in the account.devices array, handle error or return null
    return {str:'deviceNotOwned'};
  }

  const releaseTimestamp = new Date();
  const releaseSnapshot = {
    deviceId: device.id,
    streamId: device.streamId,
    macAddress: device.macAddress,
    network: device.network,
    station: device.station,
    description: device.description,
    longitude: device.longitude,
    latitude: device.latitude,
    elevation: device.elevation,
    releasedAt: releaseTimestamp,
    reason: 'unlink',
  };

  const applyRelease = async (tx = null) => {
    await DevicesRepo.update(device.id, {
      activity: 'unlinked',
      activityToggleTime: releaseTimestamp,
      rshakeAlertCredentialHash: null,
      rshakeAlertCredentialIssuedAt: null,
    }, { tx });
    await DevicesRepo.recordRelease(user.id, device.id, releaseSnapshot, { tx });
  };

  try {
    await withTransaction((tx) => applyRelease(tx));
  } catch (err) {
    if (!isTransactionUnsupported(err)) {
      throw err;
    }
    await applyRelease();
  }

  return {str:'success'}
}

/***************************************************************************
  * resetDeviceLink:
  *     Removes a device record entirely and detaches all account references,
  *     including released-device history entries that still point to it.
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
  if (!macAddress && !streamId) {
    return { str: 'missingIdentifiers' };
  }

  const candidates = await DevicesRepo.findByMacAddressOrStreamId({ macAddress, streamId });
  if (!candidates || candidates.length === 0) {
    return { str: 'deviceNotFound' };
  }

  const uniqueIds = [...new Set(candidates.map((device) => device.id))];
  if (uniqueIds.length > 1) {
    return { str: 'identifierMismatch' };
  }

  const device = candidates[0];
  const linkedAccounts = await DevicesRepo.findAccountsListing(device.id);
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

  await DevicesRepo.removeFromAllAccounts(device.id);
  await DevicesRepo.clearReleases({
    deviceId: device.id,
    streamId: device.streamId || streamId,
    macAddress: device.macAddress || macAddress,
  });

  await DevicesRepo.remove(device.id);

  return {
    str: 'success',
    payload: {
      removedAccounts: linkedUsernames,
      ownershipConfirmed: ownedByRequester,
    },
  };
}
