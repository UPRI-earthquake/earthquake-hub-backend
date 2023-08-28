const Joi = require('joi');
const DeviceService = require('../services/device.service')
const {responseCodes} = require('./responseCodes')
const {formatErrorMessage} = require('./helpers')

exports.getAllDeviceLocations = async (req, res, next) => {
  // No validation for GET request

  try {
    // Perform Task
    returnObj = await DeviceService.getAllDeviceLocations()

    // Respond based on returned value
    let message = "";

    switch (returnObj.str) {
      case "noDevicesFound":
        message = 'No Devices found in DB!';
        res.status(400).json({
          status: responseCodes.GENERIC_ERROR,
          message: message
        });
        break;
      case "success":
        message = 'All device locations found';
        res.status(200).json({
          status: responseCodes.GENERIC_SUCCESS,
          message: message, 
          payload: returnObj.devices
        });
        break;
      default:
        throw Error(`Unhandled return value ${returnObj} from service.getAllDeviceLocations()`);
    }

    res.message = message; // used by next middleware

    return;
  }catch(error){
    console.log(`Getting all device locations unsuccessful: \n ${error}`);
    next(error)
  }
}

exports.getOwnedDevices = async (req, res, next) => {
  try {
    // No validation for GET request
   
    // Perform Task
    const returnObj = await DeviceService.getAccountDevices(req.username);

    // Respond based on returned value
    let message = "";
    
    switch (returnObj.str) {
      case "usernameNotFound":
        message = "Getting user record failed";
        res.status(400).json({
          status: responseCodes.GENERIC_ERROR,
          message: message,
        });
        break;
      case "success":
        message = "Get owned devices success";
        res.status(200).json({
          status: responseCodes.GENERIC_SUCCESS,
          message: message,
          devices: returnObj.devices
        });
        break;
      default:
        throw Error(`Unhandled return value ${returnObj} from service.getAccountDevices()`);
    }
    
    res.message = message; // used by next middleware

    return;
  } catch (error) {
    console.log(`Error getting owned devices: \n ${error}`);
    next(error);
  }
};

exports.getDeviceStatus = async (req, res, next) => {
  // Define validation schema
  const deviceStatusQuerySchema = Joi.object({
    network: Joi.string()
      .regex(/^[A-Z]{2}$/)
      .required()
      .messages({
        "any.required": "Network is required.",
        "string.pattern.base": "Invalid network format. Please provide a valid 2-letter uppercase code.",
      }),
    station: Joi.string()
      .regex(/^[A-Z0-9]{3,5}$/)
      .required()
      .messages({
        "any.required": "Station is required.",
        "string.pattern.base": "Invalid station format. Please provide a valid 3 to 5-character uppercase alphanumeric code.",
      }),
  });

  try {
    // Validate query params
    const {error, value} = deviceStatusQuerySchema.validate(req.query)
    if(error){
      const errorMessages = error.details.map(
        (detail) => formatErrorMessage(detail.message)
      );
      console.error("Validation Errors:", errorMessages);
      res.status(400).json({
        status: responseCodes.GENERIC_ERROR,
        message: errorMessages[0]
      });
      return;
    }
    const {network, station} = value

    // Perform Task
    const returnObj = await DeviceService.getDeviceStatus(network, station);

    // Respond based on returned value
    let message = "";
    
    switch (returnObj.str) {
      case "deviceNotFound":
        message = "Device not found";
        res.status(400).json({
          status: responseCodes.GENERIC_ERROR,
          message: message,
        });
        break;
      case "success":
        message = "Get device status success";
        res.status(200).json({
          status: responseCodes.GENERIC_SUCCESS,
          message: message,
          payload: returnObj.device
        });
        break;
      default:
        throw Error(`Unhandled return value ${returnObj} from service.getDeviceStatus()`);
    }
    
    res.message = message; // used by next middleware

    return;
  }catch(error){
    console.log(`Error getting device status: \n ${error}`);
    next(error);
  }
}

exports.addDevice = async (req, res, next) => {
  // Define validation schema
  const addDeviceSchema = Joi.object().keys({
    network: Joi.string()
      .regex(/^[a-zA-Z]{2}$/)
      .required()
      .messages({
        "string.pattern.base": "Please provide a valid 2-letter network code.",
      }),
    station: Joi.string()
      .regex(/^[a-zA-Z0-9]{3,5}$/)
      .required()
      .messages({
        "string.pattern.base": "Please provide a valid 3 to 5-character alphanumeric station code.",
      }),
    elevation: Joi.string()
      .regex(/^[-+]?\d+(\.\d+)?$/)
      .required()
      .messages({
        "string.pattern.base": "Please provide a valid elevation value.",
      }),
    latitude: Joi.string()
      .regex(/^[-+]?(?:90(?:\.0{1,6})?|(?:[0-8]?\d(?:\.\d{1,6})?))$/)
      .required()
      .messages({
        "string.pattern.base": "Please provide a valid latitude value.",
      }),
    longitude: Joi.string()
      .regex(/^[-+]?(?:180(?:\.0{1,6})?|(?:1[0-7]\d|0?\d{1,2})(?:\.\d{1,6})?)$/)
      .required()
      .messages({
        "string.pattern.base": "Please provide a valid longitude value.",
      }),
  }).messages({ // Default message if no custom message is set for the key
    "any.required": "{#label} is required.",
    "string.empty": "{#label} cannot be empty.",
  });

  try {
    // token verification should put username from token to req.username
    if (!req.username){
      res.status(403).json({ status: responseCodes.GENERIC_ERROR, message: "Username of a logged-in user is required."});
    }

    // Validate POST input
    const {error, value} = addDeviceSchema.validate(req.body)
    if(error){
      const errorMessages = error.details.map(
        (detail) => formatErrorMessage(detail.message)
      );
      console.error("Validation Errors:", errorMessages);

      res.status(400).json({
        status: responseCodes.GENERIC_ERROR,
        message: error.details[0].message
      });

      return;
    }
    const {network, station, elevation, latitude, longitude} = value

    // Perform Task
    returnStr = await DeviceService.addDevice(req.username, network, station, elevation, latitude, longitude);

    let message = "";
    
    switch (returnStr) {
      case "detailsAlreadyUsed":
        message = "Device details already used";
        res.status(400).json({
          status: responseCodes.GENERIC_ERROR,
          message: message,
        });
        break;
      case "success":
        message = "Successfully added device";
        res.status(200).json({
          status: responseCodes.GENERIC_SUCCESS,
          message: message,
        });
        break;
      default:
        throw Error(`Unhandled return value ${returnStr} from service.addDevice()`);
    }
    
    res.message = message; // used by next middleware

    return;
  } catch (error) {
    console.log(`Add device unsuccessful: \n ${error}`);
    next(error)
  }
}

exports.linkDevice = async (req, res, next) => {
  // Define validation schema
  const linkDeviceSchema = Joi.object().keys({
    macAddress: Joi.string().regex(/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/)
     .required()
     .messages({
        "string.pattern.base": "Please provide a valid MAC address string.",
      }),
    streamId: Joi.string().regex(/^[A-Z]{2}_[A-Z0-9]{5}_.*\/MSEED$/)
     .required()
     .messages({
        "string.pattern.base": "Please provide a valid Stream ID string.",
      }),
  }).messages({ // Default message if no custom message is set for the key
    "any.required": "{#label} is required.",
    "string.empty": "{#label} cannot be empty.",
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

    let message = "";
    
    switch (returnObj.str) {
      case 'alreadyLinked':
        message = 'Device is already linked to an existing account';
        res.status(400).json({
          status: responseCodes.GENERIC_ERROR,
          message: message
        });
        break;
      case 'usernameNotFound':
        message = 'User not found';
        res.status(400).json({
          status: responseCodes.GENERIC_ERROR,
          message: message
        });
        break;
      case 'deviceNotFound':
        message = "Device doesn't exist in the database!";
        res.status(400).json({
          status: responseCodes.GENERIC_ERROR,
          message: message
        });
        break;
      case 'deviceNotOwned':
        message = "Device is not yet added to user's device list";
        res.status(400).json({
          status: responseCodes.GENERIC_ERROR,
          message: message
        });
        break;
      case 'success':
        message = 'Device-Account Linking Successful';
        res.status(200).json({
          status: responseCodes.GENERIC_SUCCESS,
          message: message,
          payload: returnObj.payload
        });
        break;
      default:
        throw Error(`Unhandled return value ${returnObj} from service.linkDevice()`);
    }
    
    res.message = message; // used by next middleware

    return;
  } catch (error) {
    console.log(`Link device unsuccessful: \n ${error}`);
    next(error)
  }
}

exports.unlinkDevice = async (req, res, next) => {
  console.log('Unlink device requested');

  // Define validation schema
  const deviceUnlinkSchema = Joi.object().keys({
    macAddress: Joi.string().regex(/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/).required(),
    streamId: Joi.string().regex(/^[A-Z]{2}_[A-Z0-9]{5}_.*\/MSEED$/).required()
  });

  try {
    // token verification should put username from token to req.username
    if (!req.username){
      res.status(403).json({ status: 403, message: "Username of a logged-in user is required."});
    }

    // Validate POST input
    const {error, value} = deviceUnlinkSchema.validate(req.body)
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
    returnObj = await DeviceService.unlinkDevice(req.username, macAddress, streamId)

    switch(returnObj.str){
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
          message: "Device does not belong to you"
        });
        break;
      case 'success':
        res.status(200).json({
          status: responseCodes.GENERIC_SUCCESS,
          message: 'Device-Account Unlinking Successful'
        })
        break;
      default:
        throw Error(`Unhandled return value ${returnObj} from service.unlinkDevice()`);
    }

  } catch (error) {
    console.log(`Unlink device unsuccessful: \n ${error}`);
    next(error)
  }
}
