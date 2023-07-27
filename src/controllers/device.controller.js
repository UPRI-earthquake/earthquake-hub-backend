const Joi = require('joi');
const DeviceService = require('../services/device.service')
const {responseCodes} = require('../routes/responseCodes')

exports.getAllDeviceLocations = async (req, res, next) => {
  console.log("Locations of all devices requested");

  // No validation for GET request

  try {
    // Perform Task
    returnObj = await DeviceService.getAllDeviceLocations()

    // Respond based on returned value
    switch (returnObj.str) {
      case "noDevicesFound":
        res.status(400).json({
          status: responseCodes.GENERIC_ERROR,
          message: 'No Devices found in DB!'
        });
        break;
      case "success":
        res.status(200).json({
          status: responseCodes.GENERIC_SUCCESS,
          message: 'All device locations found', 
          payload: returnObj.devices
        });
        break;
      default:
        throw Error(`Unhandled return value ${returnObj} from service.getAllDeviceLocations()`)
    }

    return;
  }catch(error){
    console.log(`Getting all device locations unsuccessful: \n ${error}`);
    next(error)
  }
}

exports.getOwnedDevices = async (req, res, next) => {
  console.log('Owned devices requested');
  try {

    // Perform Task
    const returnObj = await DeviceService.getAccountDevices(req.username);

    // Respond based on returned value
    switch (returnObj.str) {
      case "usernameNotFound":
        res.status(400).json({
          status: responseCodes.GENERIC_ERROR,
          message: "Getting user record failed",
        });
        break;
      case "success":
        res.status(200).json({
          status: responseCodes.GENERIC_SUCCESS,
          message: "Get owned devices success",
          devices: returnObj.devices
        });
        break;
      default:
        throw Error(`Unhandled return value ${returnObj} from service.getAccountDevices()`);
    }

    return;
  } catch (error) {
    console.log(`Error getting owned devices: \n ${error}`);
    next(error);
  }
};

exports.getDeviceStatus = async (req, res, next) => {
  console.log('Device status requested');

  // Define validation schema
  const deviceStatusQuerySchema = Joi.object({
    network: Joi.string().regex(/^[A-Z]{2}$/).required(),
    station: Joi.string().regex(/^[A-Z0-9]{3,5}$/).required(),
  });

  try {
    // Validate query params
    const {error, value} = deviceStatusQuerySchema.validate(req.query)
    if(error){
      console.log(error.details[0].message)
      res.status(400).json({
        status: responseCodes.GENERIC_ERROR,
        message: error.details[0].message
      });
      return;
    }
    const {network, station} = value

    // Perform Task
    const returnObj = await DeviceService.getDeviceStatus(network, station);

    // Respond based on returned value
    switch (returnObj.str) {
      case "deviceNotFound":
        res.status(400).json({
          status: responseCodes.GENERIC_ERROR,
          message: "Device not found",
        });
        break;
      case "success":
        res.status(200).json({
          status: responseCodes.GENERIC_SUCCESS,
          message: "Get device status success",
          payload: returnObj.device
        });
        break;
      default:
        throw Error(`Unhandled return value ${returnObj} from service.getDeviceStatus()`);
    }

    return;
  }catch(error){
    console.log(`Error getting device status: \n ${error}`);
    next(error);
  }
}

exports.addDevice = async (req, res, next) => {
  console.log("Add device requested");

  // Define validation schema
  const addDeviceSchema = Joi.object().keys({
    network: Joi.string().regex(/^[A-Z]{2}$/).required(),
    station: Joi.string().regex(/^[A-Z0-9]{3,5}$/).required(),
    elevation: Joi.string().regex(/^[-+]?\d+(\.\d+)?$/).required(),
    latitude: Joi.string().regex(/^[-+]?(?:90(?:\.0{1,6})?|(?:[0-8]?\d(?:\.\d{1,6})?))$/).required(),
    longitude: Joi.string().regex(/^[-+]?(?:180(?:\.0{1,6})?|(?:1[0-7]\d|0?\d{1,2})(?:\.\d{1,6})?)$/).required()
  });

  try {
    // token verification should put username from token to req.username
    if (!req.username){
      res.status(403).json({ status: responseCodes.GENERIC_ERROR, message: "Username of a logged-in user is required."});
    }

    // Validate POST input
    const {error, value} = addDeviceSchema.validate(req.body)
    if(error){
      console.log(error.details[0].message)
      res.status(400).json({
        status: responseCodes.GENERIC_ERROR,
        message: error.details[0].message
      });
      return;
    }
    const {network, station, elevation, latitude, longitude} = value

    // Perform Task
    returnStr = await DeviceService.addDevice(req.username, network, station, elevation, latitude, longitude);

    switch(returnStr) {
      case "detailsAlreadyUsed":
        res.status(400).json({
          status: responseCodes.GENERIC_ERROR,
          message: "Device details already used",
        });
        break;
      case "success":
        res.status(200).json({
          status: responseCodes.GENERIC_SUCCESS,
          message: "Successfully added device",
        });
        break;
      default:
        throw Error(`Unhandled return value ${returnStr} from service.addDevice()`);
    }

    return;
  } catch (error) {
    console.log(`Add device unsuccessful: \n ${error}`);
    next(error)
  }
}

exports.linkDevice = async (req, res, next) => {
  console.log('Link device requested');

  // Define validation schema
  const linkDeviceSchema = Joi.object().keys({
    macAddress: Joi.string().regex(/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/).required(),
    streamId: Joi.string().regex(/^[A-Z]{2}_[A-Z0-9]{5}_.*\/MSEED$/).required()

  });

  try {
    // token verification should put username from token to req.username
    if (!req.username){
      res.status(403).json({ status: 403, message: "Username of a logged-in user is required."});
    }

    // Validate POST input
    const {error, value} = linkDeviceSchema.validate(req.body)
      if(error){
        console.log(error.details[0].message)
        res.status(400).json({
          status: responseCodes.GENERIC_ERROR,
          message: error.details[0].message
      });
      return;
    }
    const {macAddress, streamId} = value

    // Perform task
    returnObj = await DeviceService.linkDevice(req.username, macAddress, streamId)

    switch(returnObj.str){
      case 'alreadyLinked':
        res.status(400).json({
          status: responseCodes.GENERIC_ERROR,
          message: 'Device is already linked to an existing account'
        })
        break;
      case 'usernameNotFound':
        res.status(400).json({
          status: responseCodes.GENERIC_ERROR,
          message: "User not found"
        });
        break;
      case 'deviceNotFound':
        res.status(400).json({
          status: responseCodes.GENERIC_ERROR,
          message: "Device doesn't exist in the database!"
        });
        break;
      case 'deviceNotOwned':
        res.status(400).json({
          status: responseCodes.GENERIC_ERROR,
          message: "Device is not yet added to user's device list"
        });
        break;
      case 'success':
        res.status(200).json({
          status: responseCodes.GENERIC_SUCCESS,
          message: 'Device-Account Linking Successful',
          payload: returnObj.payload
        })
        break;
      default:
        throw Error(`Unhandled return value ${returnObj} from service.linkDevice()`);
    }

  } catch (error) {
    console.log(`Link device unsuccessful: \n ${error}`);
    next(error)
  }
}
