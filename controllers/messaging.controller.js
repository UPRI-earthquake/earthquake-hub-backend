const Joi = require('joi');
const MessagingService = require('../services/messaging.service')
const EQEventsService = require('../services/events')
const {responseCodes} = require('../routes/responseCodes')

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
    latitude_value: Joi.number().min(-90).max(90).required(),
    longitude_value: Joi.number().min(-180).max(180).required(),
    depth_value: Joi.number().required(),
    magnitude_value: Joi.number().required(),
    eventType: Joi.string().required(),
    method: Joi.string().required(),
    text: Joi.string().required(),
    last_modification: Joi.date().required(),
  });

  try {

    const {error, value} = schema.validate(req.body)
    if(error){
      console.log(error.details[0].message)
      res.status(400).json({
        status: responseCodes.GENERIC_ERROR,
        message: error.details[0].message
      });
      return;
    }

    // Perform Task A
    console.log('Adding new event to SSE')
    let returnStrA = await MessagingService.eventCache.newEvent("SC_*", req.body, "SC_EVENT");
    switch(returnStrA){
      case 'success':
        console.log("New event added to SSE") // proceed to next task
        break;
      default:
        throw Error(`Unhandled return value ${returnStrA} from service.EventCache.newEvent()`)

    }

    // Perform Task B
    let returnStrB = await EQEventsService.addEQEvent(
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
    switch(returnStrB){
      case 'success':
        console.log(`Add event to DB successful`);
        return res.status(200).json({
          status: responseCodes.GENERIC_SUCCESS,
          message: "New event published to SSE and added to DB"
        });
        break;
      default:
        throw Error(`Unhandled return value ${returnStrA} from service.EventCache.newEvent()`)

    }

  } catch (error) {
    console.log(`Adding new event unsuccessful: \n ${error}`);
    next(error);
  }
}

exports.newPick = async (req, res, next) => {
  // Define validation Schema
  const schema = Joi.object({
    networkCode: Joi.string().regex(/^[A-Z]{2}$/).required(),
    stationCode: Joi.string().regex(/^[A-Z0-9]{3,5}$/).required(),
    timestamp: Joi.string().isoDate().required()
  });

  try {

    // Validate POST input
    const {error, value} = schema.validate(req.body)
    if(error){
      console.log(error.details[0].message)
      res.status(400).json({
        status: responseCodes.GENERIC_ERROR,
        message: error.details[0].message
      });
      return;
    }

    // Perform Task
    console.log('Adding new pick to SSE')
    let returnStr = await MessagingService.eventCache.newEvent("SC_*", value, "SC_PICK");

    // Respond based on returned value
    switch(returnStr){
      case 'success':
        res.status(200).json({
          status: responseCodes.GENERIC_SUCCESS,
          message: "Pick received"
        })
        break;
      default:
        throw Error(`Unhandled return value ${returnStr} from service.EventCache.newEvent()`)

    }

  } catch (error) {
    console.log(`Adding new pick unsuccessful: \n ${error}`);
    next(error)
  }
}

