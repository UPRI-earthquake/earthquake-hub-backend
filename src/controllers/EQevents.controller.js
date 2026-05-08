const Joi = require('joi')
const EQEventsService = require('../services/EQevents.service')
const {responseCodes} = require('./responseCodes')
const {formatErrorMessage} = require('./helpers')

// query database
exports.getEQEvents = async (req, res, next) => {
  // Define validation schema
  const schema = Joi.object({
    startTime: Joi.date().iso().required()
    .messages({
      "any.required": "Start time is required.",
      "date.iso": "Invalid start time format. Please provide a valid ISO date format.",
    }),
    endTime: Joi.date().iso().required()
    .messages({
      "any.required": "End time is required.",
      "date.iso": "Invalid end time format. Please provide a valid ISO date format.",
    }),
  });

  try {
    // Validate query
    const {error, value} = schema.validate(req.query)
    if(error){ throw error }
    const {startTime, endTime} = value

    // Perform Task
    // get data from db
    var data = await EQEventsService.getEventsList(startTime, endTime);
    // append regional data 
    var updatedData = await EQEventsService.addPlacesAttribute(data)

    // Respond based on returned values
    if(updatedData){
      let message = "EQ events acquired successfully";
      res.status(200).json({
        status: responseCodes.GENERIC_SUCCESS,
        message: message,
        payload: updatedData
      });
      res.message = message;
    }
  }catch(err){
    console.trace(`Getting EQevents unsuccessful \n ${err}`);
    next(err)
  }
}

exports.getEQEventByPublicID = async (req, res, next) => {
  const schema = Joi.object({
    publicID: Joi.string().trim().min(1).max(256).required()
      .messages({
        "any.required": "Public ID is required.",
        "string.empty": "Public ID is required.",
        "string.max": "Public ID must be 256 characters or fewer.",
      }),
  });

  try {
    const { error, value } = schema.validate(req.params);
    if (error) { throw error }

    const event = await EQEventsService.getEventByPublicID(value.publicID);
    if (!event) {
      const message = `Earthquake with publicID "${value.publicID}" was not found.`;
      res.status(404).json({
        status: responseCodes.GENERIC_ERROR,
        message,
        payload: null
      });
      res.message = message;
      return;
    }

    const [eventWithPlace] = await EQEventsService.addPlacesAttribute([event]);
    const message = "EQ event acquired successfully";
    res.status(200).json({
      status: responseCodes.GENERIC_SUCCESS,
      message,
      payload: eventWithPlace || event
    });
    res.message = message;
  } catch (err) {
    console.trace(`Getting EQevent by publicID unsuccessful \n ${err}`);
    next(err);
  }
}

// update onlineStations for all events
exports.updateOnlineStations = async (req, res, next) => {
  try {
    const result = await EQEventsService.updateOnlineStations();

    const message = `Updated onlineStations: ${result.modifiedCount} events modified, ${result.matchedCount} events matched, using ${result.usableDevicesCount} devices.`;
    console.log(message);

    res.status(200).json({
      status: responseCodes.GENERIC_SUCCESS,
      message: message,
      payload: result
    });
  } catch (err) {
    console.trace(`Updating onlineStations unsuccessful \n ${err}`);
    next(err);
  }
};

exports.addAdditionalInformation = async (req, res, next) => {
  try {
    console.log('inside add additional information')
    const result = await EQEventsService.addAdditionalInformation();
    const message = `Added additional information to events: ${result.modifiedCount} events modified, ${result.skippedCount} events skipped, out of ${result.totalProcessed} total processed.`;
    console.log(message);
    res.status(200).json({
      status: responseCodes.GENERIC_SUCCESS,
      message: message,
      payload: result
    });
  } catch (err) {
    console.trace(`Adding additional information unsuccessful \n ${err}`);
    next(err);
  }
}
