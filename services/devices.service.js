const Joi = require('joi');
const Device = require('../models/device.model');
const Account = require('../models/account.model');

const addDeviceSchema = Joi.object().keys({
  network: Joi.string().regex(/^[A-Z]{2}$/).required(),
  station: Joi.string().regex(/^[A-Z0-9]{3,5}$/).required(),
  elevation: Joi.string().regex(/^[-+]?\d+(\.\d+)?$/).required(),
  latitude: Joi.string().regex(/^[-+]?(?:90(?:\.0{1,6})?|(?:[0-8]?\d(?:\.\d{1,6})?))$/).required(),
  longitude: Joi.string().regex(/^[-+]?(?:180(?:\.0{1,6})?|(?:1[0-7]\d|0?\d{1,2})(?:\.\d{1,6})?)$/).required()
});

const addDevice = async (req, res) => {
  console.log("Add device requested");

  try {
    // token verification should put username from token to req.username
    if (!req.username){
      res.status(403).json({ status: 403, message: "Username of a logged-in user is required."});
    }

    const result = addDeviceSchema.validate(req.body)
    if(result.error){
      console.log(result.error.details[0].message)
      res.status(400).json({ status: 400, message: result.error.details[0].message});
      return;
    }

    // check if user inputs for the device are not yet saved in the database
    const deviceDetailsCheck = await Device.findOne({
      network: result.value.network,
      station: result.value.station,
    });
    if (deviceDetailsCheck) {
      // throw Error('Username does not exist')r
      res.status(400).json({ status: 400, message: 'Device details already used'});
      return;
    }

    const newDevice = new Device({
      network: result.value.network.toUpperCase(),
      station: result.value.station.toUpperCase(),
      elevation: result.value.elevation,
      longitude: result.value.longitude,
      latitude: result.value.latitude
    });
    await newDevice.save(); // save new entry to device collections

    const currentAccount = await Account.findOne({ 'username' : req.username });
    await currentAccount.updateOne({ // update devices array under accounts collection
      $push: { devices: newDevice._id }
    });

    console.log(`Add device successful`);
    return res.status(200).json({ status: 200, message: "Succesfully Added Device" });
  } catch (error) {
    console.log(`Add device unsuccessful: \n ${error}`);
    next(error)
  }
}

const linkDeviceSchema = Joi.object().keys({
  macAddress: Joi.string().regex(/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/).required(),
  streamId: Joi.string().regex(/^[A-Z]{2}_[A-Z0-9]{5}_.*\/MSEED$/).required()

});

const linkDevice = async (req, res) => {
  console.log('Device Link Requested');

  try {
    // token verification should put username from token to req.username
    if (!req.username){
      res.status(403).json({ status: 403, message: "Username of a logged-in user is required."});
    }

    const result = linkDeviceSchema.validate(req.body)
     if(result.error){
      console.log(result.error.details[0].message)
      res.status(400).json({ status: 400, message: result.error.details[0].message});
      return;
    }

    // check if device's mac address already exists in the database
    const deviceExists = await Device.exists({
      macAddress: result.value.macAddress
    })

    if (deviceExists) { // device is already saved to db
      // Send message to front end that device is already used
      res.status(400).json({ message: 'Device is Already Linked to an Existing Account' }) // send 400 - resource exists
      return;
    }

    const user = await Account.findOne({ 'username': req.username }).populate('devices')

    // Must be an existing user account to accept device linking request - update db.
    // get device with same Network and Station
    const [network, station, loc, channel] = result.value.streamId.split(",")[0].split("_")
    const device = await Device.findOne({ network:network, station:station })

    if(!device){
      res.status(400).json({ status: 400, message: "Device doesn't exist in the database!"});
      return;
    }

    // find the index of the device in the user.devices array
    const index = user.devices.findIndex(dev => dev.id === device.id);

    if (index === -1) {
      // device not found in the account.devices array, handle error or return null
      res.status(400).json({ status: 400, message: "Device is not yet added to user's device list"});
      return;
    }

    //Update device info
    device.macAddress = result.value.macAddress
    device.streamId = result.value.streamId
    device.save()

    // Query updated device information
    const updatedDevice = await Device.findOne({ _id: device._id })

    const deviceInfo = {
      deviceInfo: {
        network: updatedDevice.network,
        station: updatedDevice.station,
        longitude: updatedDevice.longitude,
        latitude: updatedDevice.latitude,
        elevation: updatedDevice.elevation,
        streamId: updatedDevice.streamId
      }
    }

    console.log("Update account's device successful")
    res.status(200).json({ message: 'Device-Account Linking Successful', payload: deviceInfo })
  } catch (error) {
    console.log(`Link device unsuccessful: \n ${error}`);
    next(error)
  }
}

const getDeviceList = async (req, res) => {
  console.log('GET request on /device/deviceList endpoint received')
  const citizen = await Account.findOne({ 'username': req.username }).populate('devices');  // get citizen account, username is on req.username due to verifyTokenRole middleware
  
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

  console.log(devicePayload)

  res.status(200).json({
    status:200,
    message:"GET device success",
    payload: devicePayload
  });
}

async function getDeviceStatus(network, station){
  const device = await Device.findOne({ network: network, station: station });

  let status = '';
  let statusSince = 'Not Available';

  if (device.macAddress === 'TO_BE_LINKED') {
    status = 'Not yet linked';
  } else if (device.activity === 'inactive') {
    status = 'Not streaming';
    statusSince = device.activityToggleTime;
  } else {
    status = 'Streaming';
    statusSince = device.activityToggleTime;
  }

  let devicePayload = {
    network: device.network,
    station: device.station,
    status: status,
    statusSince: statusSince
  };

 return devicePayload;
}

module.exports = {
  addDevice,
  linkDevice,
  getDeviceList,
  getDeviceStatus
}
