const Joi = require('joi');
const MessagingService = require('../services/messaging.service')
const EQEventsService = require('../services/EQevents.service')
const NotificationsService = require('../services/notifications.service')
const DeviceAlertsService = require('../services/deviceAlerts.service')
const {responseCodes} = require('./responseCodes')
const {formatErrorMessage} = require('./helpers')
const Device = require('../models/device.model');

const rshakeAlertDeviceSchema = Joi.object({
  network: Joi.string().trim().uppercase().min(2).max(4),
  station: Joi.string().trim().uppercase().min(3).max(8),
  streamId: Joi.string().trim().min(3),
  macAddress: Joi.string().trim().min(8),
})
  .required()
  .custom((device, helpers) => {
    const hasNetwork = Boolean(device.network);
    const hasStation = Boolean(device.station);
    const hasStreamId = Boolean(device.streamId);
    const hasMacAddress = Boolean(device.macAddress);

    if (hasNetwork !== hasStation) {
      return helpers.message('Device network and station must be provided together.');
    }

    if (hasStreamId || hasMacAddress || (hasNetwork && hasStation)) {
      return device;
    }

    return helpers.message('Device must include streamId, macAddress, or both network and station.');
  });

exports.setupSSEConnection = async (req, res, next) => {
  try {
    console.log('SSE connection opened:', req.ip)

    function sendEvent(event){
      console.log(`Sending SSE: ${req.ip}\n`, event);
      res.sendEventStreamData(
        event.name, JSON.stringify(event.data), event.id
      )
    }
    MessagingService.eventCache.on("newEvent", sendEvent);

    // send heartbeats every 15 sec (client detects dead connx w/in 45 secs)
    var heartbeat = setInterval(() => {
      if(!res.writableEnded) {
        res.write(': heartbeat\n\n')
      }
    }, 15000);

    res.on('close', () => {
      clearInterval(heartbeat);
      MessagingService.eventCache.removeListener('newEvent', sendEvent);
      res.end();
      console.log('SSE connection closed:', req.ip)
    });
  } catch (error) {
    console.log(`Setting up SSE connection unsuccessful: \n ${error}`);
    next(error);
  }
}

exports.newEQEvent = async (req, res, next) => {
  /* NOTE: "EQEvent" is different from "event" as used in this codebase.
   *       "EQEvent" = an earthquake evenet detected from the data processing software, ie
   *                   SeisComp
   *       "event"   = a message within the Server-Sent-Event connection
   */

  //Define validation schema
  const schema = Joi.object().keys({
    publicID: Joi.string().required(),
    OT: Joi.date().required(),
    latitude_value: Joi.number().min(-90).max(90)
      .required()
      .messages({
        "number.min": "Latitude must be greater than or equal to -90.",
        "number.max": "Latitude must be less than or equal to 90.",
      }),
    longitude_value: Joi.number().min(-180).max(180)
      .required()
      .messages({
        "number.min": "Longitude must be greater than or equal to -180.",
        "number.max": "Longitude must be less than or equal to 180.",
      }),
    depth_value: Joi.number().required(),
    magnitude_value: Joi.number().required(),
    eventType: Joi.string().required(),
    method: Joi.string().required(),
    text: Joi.string().required(),
    last_modification: Joi.date().required()
      .messages({
        "any.required": "Last modification date is required.",
      }),
  }).messages({
    "any.required": "{#label} is required.",
  });

  try {
    const {error, value} = schema.validate(req.body, {abortEarly: false})
    if(error){ throw error }

    // Perform Task A: Notify subscribed clients
    let returnStrA = await NotificationsService.notifySubscribersEQ(value)

    // Perform Task B: Add EQevent to SSE cache
    let returnStrB = await MessagingService.eventCache.newEvent("SC_*", req.body, "SC_EVENT");

    // Perform Task C: Add EQevent to MongoDB
    let returnStrC = await EQEventsService.addEQEvent(
      value.publicID,
      value.OT,
      value.latitude_value,
      value.longitude_value,
      value.depth_value,
      value.magnitude_value,
      value.eventType,
      value.text,
      value.last_modification
    )

    // Respond based on return value
    let message = ""
    if (returnStrA === 'success' && returnStrB === 'success' && returnStrC === 'success') {
      message = "New event sent to SSE, added to DB, and published as notif (if >minMag)"
      res.status(200).json({
        status: responseCodes.GENERIC_SUCCESS,
        message: message
      });
      res.message = message
    }
    else{
      throw Error(`Not all tasks returned successfully: \n A:${returnStrA} B:${returnStrB} C:${returnStrC}`)
    }

    return;
  } catch (error) {
    console.log(`Routing new EQevent to notifs,SSE,DB unsuccessful: \n ${error}`);
    next(error);
  }
}

exports.newPick = async (req, res, next) => {
  // Define validation Schema
  const schema = Joi.object({
    networkCode: Joi.string().regex(/^[A-Z]{2}$/)
      .required()
      .messages({
        "string.pattern.base": "Please provide a valid 2-letter network code.",
      }),
    stationCode: Joi.string().regex(/^[A-Z0-9]{3,5}$/)
      .required()
      .messages({
        "string.pattern.base": "Please provide a valid 3 to 5-character alphanumeric station code.",
      }),
    timestamp: Joi.string().isoDate().required(),
  });

  try {
    // Validate POST input
    const {error, value} = schema.validate(req.body)
    if(error){ throw error }

    // Perform Task
    console.log('Adding new pick to SSE')
    let returnStr = await MessagingService.eventCache.newEvent("SC_*", value, "SC_PICK");

    // Respond based on returned value
    let message = "";
    switch(returnStr){
      case 'success':
        message = "Pick received";
        res.status(200).json({
          status: responseCodes.GENERIC_SUCCESS,
          message: message
        })
        res.message = message
        break;
      default:
        throw Error(`Unhandled return value ${returnStr} from service.EventCache.newEvent()`)
    }

  } catch (error) {
    console.log(`Adding new pick unsuccessful: \n ${error}`);
    next(error)
  }
}

exports.newRshakeAlert = async (req, res, next) => {
  const schema = Joi.object({
    schemaVersion: Joi.string().trim().required(),
    messageId: Joi.string().trim().required(),
    type: Joi.string().trim().valid('device.alert', 'device.recovery', 'device.heartbeat').required(),
    occurredAt: Joi.string().isoDate().required(),
    device: rshakeAlertDeviceSchema,
    location: Joi.object({
      latitude: Joi.number().min(-90).max(90),
      longitude: Joi.number().min(-180).max(180),
      elevation: Joi.number(),
    }).optional(),
    status: Joi.string().trim().max(64).optional(),
    alertCode: Joi.string().trim().max(64).optional(),
    severity: Joi.string().trim().valid('info', 'warning', 'critical').optional(),
    summary: Joi.string().trim().min(1).max(280).required(),
    details: Joi.object().unknown(true).optional(),
    dedupeKey: Joi.string().trim().max(160).optional(),
  });

  try {
    const { error, value } = schema.validate(req.body, { abortEarly: false });
    if (error) throw error;

    const result = await DeviceAlertsService.sendDeviceAlertEmails(value);
    if (result.str === 'deliveryFailed') {
      return res.status(502).json({
        status: responseCodes.GENERIC_ERROR,
        message: 'Alert received but email delivery failed.',
        errors: result.errors || [],
      });
    }

    const message = result.skipped
      ? `RShake alert accepted (${result.reason})`
      : 'RShake alert accepted and notifications queued';
    res.status(202).json({
      status: responseCodes.GENERIC_SUCCESS,
      message,
      payload: {
        recipients: result.recipients,
        event: {
          type: result.event?.messageType,
          deviceLabel: result.event?.deviceLabel,
          severity: result.event?.severity,
          alertCode: result.event?.alertCode,
          occurredAt: result.event?.occurredAt,
        },
      },
    });
    res.message = message;
  } catch (err) {
    if (err.name === 'ValidationError') {
      err.statusCode = 400;
    }
    next(err);
  }
};

exports.newStationStatus = async (req, res, next) => {
  // This is a restricted/admin/test endpoint to broadcast a STATION_STATUS SSE
  // and optionally update the Device document to keep DB in sync.
  const schema = Joi.object({
    network: Joi.string().trim().uppercase().min(2).max(4).required(),
    station: Joi.string().trim().uppercase().min(3).max(8).required(),
    activity: Joi.string().trim().insensitive().valid('active', 'inactive').optional(),
    status: Joi.string().trim().insensitive().valid('streaming', 'not streaming').optional(),
    statusSince: Joi.string().isoDate().optional(),
  }).or('activity', 'status');

  try {
    const { error, value } = schema.validate(req.body, { abortEarly: false });
    if (error) throw error;

    const network = String(value.network).toUpperCase();
    const station = String(value.station).toUpperCase();

    // Derive canonical values
    let activity = value.activity ? String(value.activity).toLowerCase() : '';
    if (!activity) {
      const s = String(value.status || '').toLowerCase();
      activity = (s === 'streaming' || s === 'online' || s === 'active') ? 'active' : 'inactive';
    }
    const statusLabel = value.status
      ? (String(value.status).toLowerCase() === 'streaming' ? 'Streaming' : 'Not Streaming')
      : (activity === 'active' ? 'Streaming' : 'Not Streaming');
    const since = value.statusSince ? new Date(value.statusSince) : new Date();

    const payload = {
      network,
      station,
      activity,
      status: statusLabel,
      statusSince: since,
    };

    // Broadcast via SSE
    await MessagingService.eventCache.newEvent('SC_*', payload, 'STATION_STATUS');

    // Best-effort DB sync (optional)
    try {
      const dev = await Device.findOne({ network, station });
      if (dev) {
        dev.activity = activity;
        dev.activityToggleTime = since;
        await dev.save();
      }
    } catch (_) {}

    const message = 'Station status broadcast';
    res.status(200).json({ status: responseCodes.GENERIC_SUCCESS, message, payload });
    res.message = message;
  } catch (err) {
    if (err.name === 'ValidationError') {
      // Forward to global error handler with 400
      err.statusCode = 400;
    }
    next(err);
  }
}
