const Joi = require('joi');
const AccountsService = require('../services/accounts.service');
const DeviceService = require('../services/device.service')
const TunnelEnrollmentService = require('../services/tunnelEnrollment.service');
const RemoteDeviceActionsService = require('../services/remoteDeviceActions.service');
const RshakeAlertCredentialsService = require('../services/rshakeAlertCredentials.service');
const Account = require('../models/account.model');
const logger = require('../middlewares/logger.middleware');
const {responseCodes} = require('./responseCodes')
const {formatErrorMessage, generateAccessToken, generateRefreshToken, getRefreshTokenSecret} = require('./helpers')
const jwt = require('jsonwebtoken');

const ALLOWED_REFRESH_ROLES = new Set(['sensor', 'brgy']);

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
    // No validation for GET request; auth already enforced by middleware
    const returnObj = await DeviceService.getAccountDevices(req.username);

    let message = '';
    switch (returnObj.str) {
      case 'usernameNotFound':
        message = 'Getting user record failed';
        res.status(400).json({
          status: responseCodes.GENERIC_ERROR,
          message,
        });
        break;
      case 'success':
        message = 'Get owned devices success';
        res.status(200).json({
          status: responseCodes.GENERIC_SUCCESS,
          message,
          devices: returnObj.devices,
          releasedDevices: returnObj.releasedDevices || [],
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
    password: Joi.string().min(1).max(256).required().messages({
      'string.min': 'Password is required.',
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
    const loginResult = await AccountsService.loginAccountRole(username, password, role)
    const returnStr = loginResult?.str || loginResult;
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

    // Return access + refresh tokens within the payload
    let message = 'Device-Account Linking Successful';
    let status = responseCodes.LINKING_SUCCESS
    if (returnObj.str === 'alreadyLinked'){ 
      message = 'Device-Account already linked';
      status = responseCodes.LINKING_ALREADY_DONE
    }
    const alertCredential = await RshakeAlertCredentialsService.issueAlertCredentialForOwnedDevice({
      username,
      identifiers: {
        macAddress,
        streamId,
      },
    });
    if (alertCredential.str !== 'success') {
      throw new Error(alertCredential.str);
    }

    res.status(200).json({
      status: status,
      message: message,
      payload: {
        ...returnObj.payload,
        rshakeAlertCredential: alertCredential.payload,
        accessToken: generateAccessToken({
          'username': username,
          'role': role
        }, 'device'),
        refreshToken: generateRefreshToken({
          'username': username,
          'role': role
        }, 'device')
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
        message = 'Device is already linked to another account';
        res.status(409).json({
          status: responseCodes.GENERIC_ERROR,
          message: message,
          errorCode: 'DEVICE_LINKED_TO_OTHER_ACCOUNT',
        });
        break;
      case 'invalidRole':
        message = 'Account is not allowed to link a device (sensor role required)';
        res.status(403).json({
          status: responseCodes.GENERIC_ERROR,
          message: message,
        });
        break;
      case 'incorrectAMStation':
        message = "Station code incorrect for an AM device";
        res.status(400).json({
          status: responseCodes.GENERIC_ERROR,
          message: message
        });
        break;
      case 'deviceNotFound':
      case 'deviceNotOwned':
      case 'identifierMismatch':
        message = 'Unable to issue device alert credential after linking';
        res.status(409).json({
          status: responseCodes.GENERIC_ERROR,
          message,
        });
        break;

      default:
        next(error)
        return
    }
    res.message = message; // used by next middleware
  }
}

exports.refreshToken = async (req, res, next) => {
  const schema = Joi.object({
    refreshToken: Joi.string().required(),
  });

  try {
    const { error, value } = schema.validate(req.body);
    if (error) throw error;
    const { refreshToken } = value;

    let decoded;
    let refreshScope = 'device';
    try {
      decoded = jwt.verify(refreshToken, getRefreshTokenSecret('device'));
    } catch (verifyErr) {
      try {
        decoded = jwt.verify(refreshToken, getRefreshTokenSecret('brgy'));
        refreshScope = 'brgy';
      } catch (verifyErr2) {
        return res.status(401).json({
          status: responseCodes.GENERIC_ERROR,
          message: 'Invalid refresh token',
        });
      }
    }

    const { username, role } = decoded;
    if (!ALLOWED_REFRESH_ROLES.has(role)) {
      return res.status(403).json({
        status: responseCodes.AUTHENTICATION_INVALID_ROLE,
        message: 'Session role not permitted for this route',
      });
    }

    const accountRecord = await Account.findOne({ username });
    if (!accountRecord || !Array.isArray(accountRecord.roles) || !accountRecord.roles.includes(role)) {
      return res.status(401).json({
        status: responseCodes.GENERIC_ERROR,
        message: 'Invalid refresh token',
      });
    }
    if (role === 'brgy' && !accountRecord.isApproved) {
      return res.status(403).json({
        status: responseCodes.AUTHENTICATION_ACCOUNT_INACTIVE,
        message: 'Account is not yet approved',
      });
    }

    // Build device info payload if available
    const account = await DeviceService.getAccountDevices(username);
    let deviceInfo = null;
    if (account.str === 'success' && account.devices?.length > 0) {
      const first = account.devices[0];
      deviceInfo = {
        network: first.network,
        station: first.station,
      };
    }

    const accessTokenScope = role === 'brgy' ? 'brgy' : 'device';
    const refreshTokenScope = role === 'brgy' ? 'brgy' : refreshScope;
    const accessToken = generateAccessToken({ username, role }, accessTokenScope);
    const newRefresh = generateRefreshToken({ username, role }, refreshTokenScope);

    res.status(200).json({
      status: responseCodes.GENERIC_SUCCESS,
      message: 'Refresh token exchanged',
      payload: {
        accessToken,
        refreshToken: newRefresh,
        deviceInfo,
      },
    });
  } catch (error) {
    console.log(`Refresh token error: ${error}`);
    next(error);
  }
}

exports.issueRshakeAlertCredential = async (req, res, next) => {
  const schema = Joi.object({
    macAddress: Joi.string().regex(/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/),
    streamId: Joi.string().regex(/^[A-Z]{2}_[A-Z0-9]{5}_.*\/MSEED$/),
    network: Joi.string().regex(/^[A-Z]{2}$/),
    station: Joi.string().regex(/^[A-Z0-9]{3,5}$/),
  })
    .or('macAddress', 'streamId', 'network')
    .and('network', 'station');

  try {
    const { error, value } = schema.validate(req.body || {}, { abortEarly: false });
    if (error) throw error;

    const result = await RshakeAlertCredentialsService.issueAlertCredentialForOwnedDevice({
      username: req.username,
      identifiers: value,
    });

    switch (result.str) {
      case 'success':
        res.status(200).json({
          status: responseCodes.GENERIC_SUCCESS,
          message: 'RShake alert credential issued',
          payload: result.payload,
        });
        res.message = 'RShake alert credential issued';
        return;
      case 'usernameNotFound':
        res.status(404).json({
          status: responseCodes.GENERIC_ERROR,
          message: 'Sensor account not found',
        });
        res.message = 'Sensor account not found';
        return;
      case 'deviceNotFound':
        res.status(404).json({
          status: responseCodes.GENERIC_ERROR,
          message: 'Linked device not found for provided identifiers',
        });
        res.message = 'Linked device not found for provided identifiers';
        return;
      case 'deviceNotOwned':
        res.status(403).json({
          status: responseCodes.GENERIC_ERROR,
          message: 'Device does not belong to the authenticated sensor',
        });
        res.message = 'Device does not belong to the authenticated sensor';
        return;
      case 'identifierMismatch':
        res.status(409).json({
          status: responseCodes.GENERIC_ERROR,
          message: 'Provided device identifiers refer to different devices',
        });
        res.message = 'Provided device identifiers refer to different devices';
        return;
      default:
        throw new Error(`Unhandled return value ${result?.str} from issueAlertCredentialForOwnedDevice()`);
    }
  } catch (error) {
    console.log(`Issue device alert credential unsuccessful: \n ${error}`);
    next(error);
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

    // Best-effort: remove device from all brgy accounts that may hold it
    try {
      const brgyAccounts = await AccountsService.getBrgyAccountsWithDevice(streamId);
      for (const brgy of brgyAccounts) {
        await AccountsService.removeDeviceFromBrgyByStreamId(brgy.username, streamId);
      }
    } catch (cleanupErr) {
      console.log(`Brgy device cleanup error during unlink: ${cleanupErr}`);
      // Do not fail unlink on cleanup error
    }

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

exports.resetDeviceLink = async (req, res, next) => {
  const resetDeviceSchema = Joi.object().keys({
    macAddress: Joi.string().regex(/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/).required(),
    streamId: Joi.string().regex(/^[A-Z]{2}_[A-Z0-9]{5}_.*\/MSEED$/).required()
  });

  try {
    const { error, value } = resetDeviceSchema.validate(req.body);
    if (error) { throw error; }
    const { macAddress, streamId } = value;

    const returnObj = await DeviceService.resetDeviceLink(req.username, macAddress, streamId);

    let message = '';
    switch (returnObj.str) {
      case 'deviceNotFound':
        message = 'Device not found or already removed';
        res.status(404).json({
          status: responseCodes.LINK_RESET_ERROR,
          message,
        });
        break;
      case 'identifierMismatch':
        message = 'Stream ID and MAC address point to different devices. Verify identifiers before resetting.';
        res.status(409).json({
          status: responseCodes.LINK_RESET_ERROR,
          message,
        });
        break;
      case 'deviceOwnedElsewhere':
        message = 'Device belongs to a different account. Request a reset from the linked account instead.';
        res.status(403).json({
          status: responseCodes.LINK_RESET_ERROR,
          message,
        });
        break;
      case 'authRequired':
        message = 'Authentication required to reset this linked device. Sign in and retry from the linked account.';
        res.status(401).json({
          status: responseCodes.LINK_RESET_ERROR,
          message,
        });
        break;
      case 'success':
        message = 'Device link reset. Re-register to link again.';
        res.status(200).json({
          status: responseCodes.LINK_RESET_SUCCESS,
          message,
          payload: returnObj.payload,
        });
        break;
      default:
        throw Error(`Unhandled return value ${returnObj} from service.resetDeviceLink()`);
    }
    res.message = message;
  } catch (error) {
    console.log(`Reset device unsuccessful: \n ${error}`);
    next(error);
  }
}

exports.enrollDeviceTunnel = async (req, res, next) => {
  const schema = Joi.object({
    deviceId: Joi.string().trim().max(128),
    deviceUuid: Joi.string().trim().max(128),
    network: Joi.string().trim().regex(/^[A-Z0-9]{2,10}$/),
    station: Joi.string().trim().regex(/^[A-Z0-9]{1,10}$/),
    tunnelPublicKey: Joi.string().trim().min(32).max(4096).required(),
    bastionUser: Joi.string().trim().regex(/^[a-z_][a-z0-9._-]{0,31}$/),
    remotePort: Joi.number().integer().min(1).max(65535),
  }).required();

  try {
    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        status: responseCodes.TUNNEL_ENROLL_ERROR || responseCodes.VALIDATION_ERROR,
        message: formatErrorMessage(error.details[0].message),
      });
    }

    const networkStationId = value.network && value.station
      ? `${value.network}_${value.station}`
      : null;
    const resolvedDeviceId = value.deviceId || value.deviceUuid || networkStationId;

    if (!resolvedDeviceId) {
      return res.status(400).json({
        status: responseCodes.TUNNEL_ENROLL_ERROR || responseCodes.VALIDATION_ERROR,
        message: 'Device identity is required (deviceId, deviceUuid, or network+station).',
      });
    }

    const mapping = await TunnelEnrollmentService.enrollDeviceTunnel({
      deviceId: resolvedDeviceId,
      tunnelPublicKey: value.tunnelPublicKey,
      bastionUser: value.bastionUser,
      remotePort: value.remotePort,
    });

    const payload = {
      deviceId: resolvedDeviceId,
      REMOTE_TUNNEL_BASTION_HOST: mapping.REMOTE_TUNNEL_BASTION_HOST,
      REMOTE_TUNNEL_BASTION_PORT: mapping.REMOTE_TUNNEL_BASTION_PORT,
      REMOTE_TUNNEL_BASTION_USER: mapping.REMOTE_TUNNEL_BASTION_USER,
      REMOTE_TUNNEL_REMOTE_PORT: mapping.REMOTE_TUNNEL_REMOTE_PORT,
    };

    if (mapping.REMOTE_TUNNEL_BASTION_HOST_KEY) {
      payload.REMOTE_TUNNEL_BASTION_HOST_KEY = mapping.REMOTE_TUNNEL_BASTION_HOST_KEY;
    }
    if (mapping.REMOTE_TUNNEL_WSS_URL) {
      payload.REMOTE_TUNNEL_WSS_URL = mapping.REMOTE_TUNNEL_WSS_URL;
    }
    if (mapping.REMOTE_TUNNEL_WSS_PATH_PREFIX) {
      payload.REMOTE_TUNNEL_WSS_PATH_PREFIX = mapping.REMOTE_TUNNEL_WSS_PATH_PREFIX;
    }
    if (mapping.REMOTE_TUNNEL_OPERATOR_PUBLIC_KEY) {
      payload.REMOTE_TUNNEL_OPERATOR_PUBLIC_KEY = mapping.REMOTE_TUNNEL_OPERATOR_PUBLIC_KEY;
    }
    if (mapping.REMOTE_TUNNEL_OPERATOR_SSH_PUBLIC_KEY) {
      payload.REMOTE_TUNNEL_OPERATOR_SSH_PUBLIC_KEY = mapping.REMOTE_TUNNEL_OPERATOR_SSH_PUBLIC_KEY;
    }

    res.status(200).json({
      status: responseCodes.TUNNEL_ENROLL_SUCCESS || responseCodes.GENERIC_SUCCESS,
      message: 'Device tunnel enrollment successful',
      payload,
    });
    res.message = 'Device tunnel enrollment successful';
  } catch (error) {
    if (error?.name === 'TunnelEnrollmentError') {
      const code = error.code || 'SCRIPT_ERROR';
      const message = error.message || 'Tunnel enrollment failed';
      if (code === 'COLLISION') {
        return res.status(409).json({
          status: responseCodes.TUNNEL_ENROLL_COLLISION || responseCodes.GENERIC_ERROR,
          message,
        });
      }
      if (code === 'VALIDATION') {
        return res.status(400).json({
          status: responseCodes.TUNNEL_ENROLL_ERROR || responseCodes.VALIDATION_ERROR,
          message,
        });
      }
      if (code === 'CONFIG_ERROR') {
        return res.status(500).json({
          status: responseCodes.TUNNEL_ENROLL_ERROR || responseCodes.GENERIC_ERROR,
          message,
        });
      }
      return res.status(502).json({
        status: responseCodes.TUNNEL_ENROLL_ERROR || responseCodes.GENERIC_ERROR,
        message,
      });
    }
    next(error);
  }
};

function parseRemoteActionDeviceIds(query = {}) {
  const normalized = [];
  const collect = (value) => {
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    if (value === undefined || value === null) {
      return;
    }
    String(value)
      .split(',')
      .map((token) => token.trim().toUpperCase())
      .filter(Boolean)
      .forEach((token) => normalized.push(token));
  };

  collect(query.deviceId);
  collect(query.deviceIds);
  return Array.from(new Set(normalized)).slice(0, 100);
}

function mapRemoteActionErrorStatus(code = '') {
  switch (String(code || '').toLowerCase()) {
    case 'not_owned':
      return 403;
    case 'validation_error':
      return 400;
    case 'not_mapped':
    case 'revoked':
    case 'offline':
      return 409;
    case 'timeout':
      return 504;
    case 'remote_failed':
      return 502;
    case 'config_error':
      return 500;
    default:
      return 500;
  }
}

function serializeRemoteActionMeta(meta = {}) {
  try {
    return JSON.stringify(meta || {});
  } catch (_error) {
    return '[unserializable-meta]';
  }
}

exports.getRemoteActionCapabilities = async (req, res, next) => {
  try {
    const deviceIds = parseRemoteActionDeviceIds(req.query);
    const capabilities = await RemoteDeviceActionsService.listRemoteActionCapabilities({
      username: req.username,
      deviceIds,
    });

    res.status(200).json({
      status: responseCodes.REMOTE_ACTION_CAPABILITIES_SUCCESS || responseCodes.GENERIC_SUCCESS,
      message: 'Remote action capabilities retrieved.',
      payload: {
        capabilities,
        availableActions: Object.values(RemoteDeviceActionsService.ACTIONS),
      },
    });
    res.message = 'Remote action capabilities retrieved.';
  } catch (error) {
    if (error?.name === 'RemoteDeviceActionError') {
      return res.status(mapRemoteActionErrorStatus(error.code)).json({
        status: responseCodes.REMOTE_ACTION_CAPABILITIES_ERROR || responseCodes.GENERIC_ERROR,
        message: error.message || 'Failed to resolve remote action capabilities.',
        errorCode: error.code || 'remote_actions_error',
      });
    }
    next(error);
  }
};

exports.getRemoteActionServers = async (req, res, next) => {
  const schema = Joi.object({
    deviceId: Joi.string().trim().max(128).required(),
  }).required();

  try {
    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        status: responseCodes.REMOTE_ACTION_SERVERS_ERROR || responseCodes.VALIDATION_ERROR,
        message: formatErrorMessage(error.details[0].message),
      });
    }

    const result = await RemoteDeviceActionsService.listRemoteDeviceServers({
      username: req.username,
      deviceId: value.deviceId,
    });

    res.status(200).json({
      status: responseCodes.REMOTE_ACTION_SERVERS_SUCCESS || responseCodes.GENERIC_SUCCESS,
      message: 'Remote device servers retrieved.',
      payload: result,
    });
    res.message = 'Remote device servers retrieved.';
  } catch (error) {
    if (error?.name === 'RemoteDeviceActionError') {
      return res.status(mapRemoteActionErrorStatus(error.code)).json({
        status: responseCodes.REMOTE_ACTION_SERVERS_ERROR || responseCodes.GENERIC_ERROR,
        message: error.message || 'Failed to read remote device servers.',
        errorCode: error.code || 'remote_actions_error',
      });
    }
    next(error);
  }
};

exports.executeRemoteAction = async (req, res, next) => {
  const schema = Joi.object({
    deviceId: Joi.string().trim().max(128).required(),
    action: Joi.string()
      .trim()
      .uppercase()
      .valid(...Object.values(RemoteDeviceActionsService.ACTIONS))
      .required(),
    payload: Joi.object().unknown(true).default({}),
  }).required();

  try {
    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        status: responseCodes.REMOTE_ACTION_EXECUTE_ERROR || responseCodes.VALIDATION_ERROR,
        message: formatErrorMessage(error.details[0].message),
      });
    }

    const result = await RemoteDeviceActionsService.executeRemoteDeviceAction({
      username: req.username,
      deviceId: value.deviceId,
      action: value.action,
      payload: value.payload,
    });

    res.status(200).json({
      status: responseCodes.REMOTE_ACTION_EXECUTE_SUCCESS || responseCodes.GENERIC_SUCCESS,
      message: 'Remote action executed.',
      payload: result,
    });
    res.message = 'Remote action executed.';
  } catch (error) {
    if (error?.name === 'RemoteDeviceActionError') {
      const rawDeviceId = String(req?.body?.deviceId || '').trim().toUpperCase();
      const rawAction = String(req?.body?.action || '').trim().toUpperCase();
      res.message = `Remote action failed (${error.code || 'remote_actions_error'})`;
      logger.error(
        `Remote action failed: code=${error.code || 'remote_actions_error'} `
        + `user=${req.username || 'unknown'} deviceId=${rawDeviceId || 'unknown'} `
        + `action=${rawAction || 'unknown'} message="${error.message || 'n/a'}" `
        + `meta=${serializeRemoteActionMeta(error.meta)}`,
        { label: 'remoteActions', ip: req.ip },
      );
      return res.status(mapRemoteActionErrorStatus(error.code)).json({
        status: responseCodes.REMOTE_ACTION_EXECUTE_ERROR || responseCodes.GENERIC_ERROR,
        message: error.message || 'Remote action execution failed.',
        errorCode: error.code || 'remote_actions_error',
      });
    }
    next(error);
  }
};

exports.listDeviceTunnels = async (req, res, next) => {
  try {
    const mappings = await TunnelEnrollmentService.listActiveMappings();
    res.status(200).json({
      status: responseCodes.TUNNEL_LIST_SUCCESS || responseCodes.GENERIC_SUCCESS,
      message: 'Active tunnel mappings retrieved',
      payload: mappings,
    });
    res.message = 'Active tunnel mappings retrieved';
  } catch (error) {
    if (error?.name === 'TunnelEnrollmentError') {
      return res.status(500).json({
        status: responseCodes.TUNNEL_LIST_ERROR || responseCodes.GENERIC_ERROR,
        message: error.message || 'Failed to list tunnel mappings',
      });
    }
    next(error);
  }
};

exports.revokeDeviceTunnel = async (req, res, next) => {
  const schema = Joi.object({
    deviceId: Joi.string().trim().max(128).required(),
  }).required();

  try {
    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        status: responseCodes.TUNNEL_REVOKE_ERROR || responseCodes.VALIDATION_ERROR,
        message: formatErrorMessage(error.details[0].message),
      });
    }

    const revoked = await TunnelEnrollmentService.revokeDeviceTunnel(value.deviceId);
    res.status(200).json({
      status: responseCodes.TUNNEL_REVOKE_SUCCESS || responseCodes.GENERIC_SUCCESS,
      message: 'Device tunnel revoked',
      payload: revoked,
    });
    res.message = 'Device tunnel revoked';
  } catch (error) {
    if (error?.name === 'TunnelEnrollmentError') {
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({
          status: responseCodes.TUNNEL_REVOKE_ERROR || responseCodes.GENERIC_ERROR,
          message: error.message || 'Device mapping not found',
        });
      }
      if (error.code === 'VALIDATION') {
        return res.status(400).json({
          status: responseCodes.TUNNEL_REVOKE_ERROR || responseCodes.VALIDATION_ERROR,
          message: error.message || 'Invalid revoke request',
        });
      }
      return res.status(502).json({
        status: responseCodes.TUNNEL_REVOKE_ERROR || responseCodes.GENERIC_ERROR,
        message: error.message || 'Failed to revoke device tunnel',
      });
    }
    next(error);
  }
};
