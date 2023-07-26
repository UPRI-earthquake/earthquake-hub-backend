const Device = require('../models/device.model');
const Account = require('../models/account.model');

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

exports.addDevice = async (username, network, station, elevation, latitude, longitude) => {
  // check if user inputs for the device are not yet saved in the database
  const deviceDetailsCheck = await Device.findOne({
    network: network,
    station: station,
  });
  if (deviceDetailsCheck) {
    // throw Error('Username does not exist')r
    res.status(400).json({ status: 400, message: 'Device details already used'});
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

  return {str:'success', deviceInfo: payload}
}



