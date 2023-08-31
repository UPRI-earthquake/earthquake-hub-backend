const Device = require('../models/device.model');
const Account = require('../models/account.model');

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
  * addDevice:
  *     Adds a new device entry to the database and associates it with the specified username.
  * 
  * Inputs:
  *     username: string       // The username of the account to associate the new device with.
  *     network: string        // The name of the network to which the device belongs.
  *     station: string        // The station code of the new device.
  *     elevation: number      // The elevation value of the new device.
  *     latitude: number       // The latitude coordinate of the new device.
  *     longitude: number      // The longitude coordinate of the new device.
  * 
  * Outputs:
  *     "success":             if the device was successfully added and associated with the username.
  *     "detailsAlreadyUsed":  if the provided device details (network and station) are already used by another device.
  * 
  * Note:
  *     - This function is asynchronous and returns a Promise that resolves to the result status string.
  *     - Before adding the new device, the function checks if the specified device details (network and station) are not
  *       already associated with another device in the database. If the details are already used, the function will return
  *       "detailsAlreadyUsed" without adding the device.
  *     - If the device is successfully added and linked to the specified username, the function will return "success."
  *     - The function will update the 'devices' array under the 'accounts' collection to associate the new device with the
  *       provided username.
 ***************************************************************************/
exports.addDevice = async (username, network, station, elevation, latitude, longitude) => {
  // check if user inputs for the device are not yet saved in the database
  const deviceDetailsCheck = await Device.findOne({
    network: network,
    station: station,
  });
  if (deviceDetailsCheck) {
    // throw Error('Username does not exist')r
    return 'detailsAlreadyUsed';
  }

  const newDevice = new Device({
    description: `${username}'s device`,
    network: network.toUpperCase(),
    station: station.toUpperCase(),
    elevation: elevation,
    longitude: longitude,
    latitude: latitude
  });
  await newDevice.save(); // save new entry to device collections

  const currentAccount = await Account.findOne({ 'username' : username });
  await currentAccount.updateOne({ // update devices array under accounts collection
    $push: { devices: newDevice._id }
  });
  
  return 'success';
}

/***************************************************************************
  * linkDevice:
  *     Links a physical device to an existing user account and updates the device record in the database.
  * 
  * Inputs:
  *     username: string       // The username of the account to which the device will be linked.
  *     macAddress: string     // The MAC address of the device to be linked.
  *     streamId: string       // The unique stream identifier of the device.
  * 
  * Output str:
  *     "success":             if the device was successfully linked to the user account and device information updated.
  *     "alreadyLinked":       if a device with the specified MAC address already exists in the database.
  *     "usernameNotFound":    if the provided username does not exist in the database.
  *     "deviceNotFound":      if a device with the specified network and station is not found in the database.
  *     "deviceNotOwned":      if the specified device is not owned by the provided username.
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
  *     - To link the device, the function first finds the device in the database using the specified network and station.
  *       This means that the device has to be "added" first before "linked"
  *     - If the device is successfully linked to the user account and the device information is updated, the function will return
  *       "success" along with an object containing the updated device information.
 ***************************************************************************/
exports.linkDevice = async(username, macAddress, streamId) => {
  // check if device's mac address already exists in the database
  const deviceExists = await Device.exists({
    macAddress: macAddress
  })

  if (deviceExists) { // device is already saved to db
    // Send message to front end that device is already used
    return {str:'alreadyLinked'};
  }

  const user = await Account.findOne({ 'username': username }).populate('devices')
  if(!user){
    return {str:'usernameNotFound'};
  }


  // Must be an existing user account to accept device linking request - update db.
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

  //Update device info
  device.macAddress = macAddress
  device.streamId = streamId
  device.save()

  // Query updated device information
  const updatedDevice = await Device.findOne({ _id: device._id })

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


