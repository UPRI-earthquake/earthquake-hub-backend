const Device = require('../models/device.model');
const Account = require('../models/account.model');
const {generateAMStationCode} = require('../controllers/helpers')

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

  let devicePayload = [];

  if (citizen.devices) {
    devicePayload = citizen.devices.map(device => {
      let status = '';
      let statusSince = 'Not Available';
      
      if (device.macAddress === 'TO_BE_LINKED') {
        status = 'Not Yet Linked';
      } else if (device.activity === 'inactive') {
        status = 'Not Streaming';
        statusSince = device.activityToggleTime.toUTCString();
      } else {
        status = 'Streaming';
        statusSince = device.activityToggleTime.toUTCString();
      }

      const deviceInfo = {
        network: device.network,
        station: device.station,
        status: status,
        statusSince: statusSince
      };

      return deviceInfo;
    });
  }

  return {
    str: 'success',
    devices: devicePayload
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
    status = 'Not yet linked';
  } else if (device.activity === 'inactive') {
    status = 'Not streaming';
    statusSince = device.activityToggleTime;
  } else {
    status = 'Streaming';
    statusSince = device.activityToggleTime;
  }

  let deviceStatus = {
    network: device.network,
    station: device.station,
    status: status,
    statusSince: statusSince
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

  // check if user already has the device in their record
  const deviceOwned = currentAccount.devices.find(device => device.macAddress === macAddress);
  if(deviceOwned){
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
    return {str:'alreadyLinked', payload: payload};
  }

  // check if device's mac address already exists in the database
  const device = await Device.findOne({macAddress: macAddress})
  if (device) { // device is already saved to db
    return {str:'alreadyLinkedToSomeone'};
  }

  // Parse device details
  const [network, station, loc, channel] = streamId.split(",")[0].split("_")

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
    streamId: streamId
  });
  await newDevice.save(); // save new entry to device collections

  await currentAccount.updateOne({ // update devices array under accounts collection
    $push: { devices: newDevice._id }
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

  
  user.devices.pull(device); // Delete the device._id from Accounts.devices array
  await user.save(); // Save the user object to persist the changes


  // Delete the device information in Devices collection
  await Device.findOneAndDelete({ network:network, station:station })

  return {str:'success'}
}


