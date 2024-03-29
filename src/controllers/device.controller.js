const Joi = require('joi');
const AccountsService = require('../services/accounts.service');
const DeviceService = require('../services/device.service')
const {responseCodes} = require('./responseCodes')
const {formatErrorMessage, generateAccessToken} = require('./helpers')

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
    if(error){ throw error }
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

exports.linkDevice = async (req, res, next) => {
  // Define validation schema
  const linkDeviceSchema = Joi.object().keys({
    username: Joi.string().required(),
    password: Joi.string()
      .pattern(new RegExp("^[a-zA-Z0-9]{6,30}$"))
      .required()
      .messages({
        "string.pattern.base": "Password must be between 6 and 30 letters and/or digits.",
      }),
    role: Joi.string().valid('sensor').required()
      .messages({
        "any.only": "Only sensor role can request device linking",
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
    // Validate POST input
    const {error, value} = linkDeviceSchema.validate(req.body)
    if(error){ throw error }
    const {username, password, role,
           network, station, elevation, latitude, longitude,
           macAddress, streamId} = value

    // Perform task: authenticate user
    returnStr = await AccountsService.loginAccountRole(username, password, role)
    if (returnStr !== 'successSensorBrgy'){
      console.log(`Adding device unsuccessful: ${returnStr}`);
      throw new Error(returnStr)
    }

    // Perform task: link device
    returnObj = await DeviceService.linkDevice(username, elevation, longitude, latitude, macAddress, streamId)
    if (returnObj.str !== 'success' && returnObj.str !== 'alreadyLinked'){
      console.log(`Link device unsuccessful: ${returnObj.str}`);
      throw new Error(returnObj.str)
    }

    // Return accesstoken within the payload
    let message = 'Device-Account Linking Successful';
    let status = responseCodes.LINKING_SUCCESS
    if (returnObj.str === 'alreadyLinked'){ 
      message = 'Device-Account already linked';
      status = responseCodes.LINKING_ALREADY_DONE
    }
    res.status(200).json({
      status: status,
      message: message,
      payload: {
        ...returnObj.payload,
        accessToken: generateAccessToken({
          'username': username,
          'role': role
        })
      }
    });
    res.message = message; // used by next middleware

    return;
  } catch (error) {
    let message = "";
    switch (error.message) {
      // Login errors for a sensor
      case "accountNotExists":
        message = "User doesn't exists!";
        res.status(400).json({
          status: responseCodes.AUTHENTICATION_USER_NOT_EXIST,
          message: message
        });
        break;
      case "wrongPassword":
        message = 'Wrong password';
        res.status(401).json({
          status: responseCodes.AUTHENTICATION_WRONG_PASSWORD,
          message: message
        });
        break;

      // Linking device error
      case 'usernameNotFound':
        message = 'User not found';
        res.status(400).json({
          status: responseCodes.GENERIC_ERROR,
          message: message
        });
        break;
      case 'alreadyLinkedToSomeone':
        message = "Device is already linked to someone else!";
        res.status(400).json({
          status: responseCodes.GENERIC_ERROR,
          message: message
        });
        break;
      case 'incorrectAMStation':
        message = "Station code incorrect for an AM device";
        res.status(400).json({
          status: responseCodes.GENERIC_ERROR,
          message: message
        });
        break;

      default:
        next(error)
        return
    }
    res.message = message; // used by next middleware
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
    if(error){ throw error }
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
