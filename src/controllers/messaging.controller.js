const Joi = require('joi');
const MessagingService = require('../services/messaging.service')
const EQEventsService = require('../services/EQevents.service')
const NotificationsService = require('../services/notifications.service')
const {responseCodes} = require('./responseCodes')
const {formatErrorMessage} = require('./helpers')

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
      value.text
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

