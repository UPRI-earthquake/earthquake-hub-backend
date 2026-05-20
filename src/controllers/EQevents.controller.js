const Joi = require('joi')
const EQEventsService = require('../services/EQevents.service')
const { acquireJobLock } = require('../services/jobLock.service')
const {responseCodes} = require('./responseCodes')
const {formatErrorMessage} = require('./helpers')

function positiveNumberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const ENRICHMENT_JOB_LOCK_NAME = 'additional-information-enrichment';
const ENRICHMENT_LOCK_TTL_MS = positiveNumberEnv('ENRICHMENT_LOCK_TTL_MS', 60 * 60 * 1000);

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

    const message = `Updated onlineStations: ${result.modifiedCount} events modified, ${result.matchedCount} events matched, ${result.skippedCount || 0} events skipped, using ${result.usableDevicesCount} devices.`;
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
  let lock = null;
  try {
    lock = await acquireJobLock(ENRICHMENT_JOB_LOCK_NAME, ENRICHMENT_LOCK_TTL_MS);
    if (!lock.acquired) {
      return res.status(409).json({
        status: responseCodes.GENERIC_ERROR,
        message: 'Additional information enrichment is already running.',
        payload: null,
      });
    }

    const result = await EQEventsService.addAdditionalInformation();
    const message =
      `Added additional information to events: ${result.modifiedCount} events modified, ` +
      `${result.completedCount || 0} completed, ${result.partialCount || 0} partial, ` +
      `${result.noMatchCount || 0} no-match, ${result.skippedCount || 0} skipped, ` +
      `${result.exhaustedCount || 0} exhausted, ${result.failedSourceCount || 0} source failures, ` +
      `out of ${result.totalProcessed} total processed.`;
    console.log(message);
    res.status(200).json({
      status: responseCodes.GENERIC_SUCCESS,
      message: message,
      payload: result
    });
  } catch (err) {
    console.trace(`Adding additional information unsuccessful \n ${err}`);
    next(err);
  } finally {
    if (lock?.acquired) {
      try {
        await lock.release();
      } catch (err) {
        console.trace(`Releasing additional information lock unsuccessful \n ${err}`);
      }
    }
  }
}

exports.patchEventSummary = async (req, res) => {
  const { publicID } = req.params;
  const { text } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({
      status: 1,
      message: 'Summary text is required and cannot be empty.',
    });
  }

  try {
    const editedBy = req.user?.id ?? req.user?.username ?? undefined;
    const updated = await EQEventsService.setEventSummary(publicID, text.trim(), editedBy);

    return res.status(200).json({
      status: 0,
      message: 'Event summary updated successfully.',
      data: updated.summaryOverride,
    });
  } catch (error) {
    const statusCode = error.status ?? 500;
    return res.status(statusCode).json({
      status: 1,
      message: error.message || 'Failed to update event summary.',
    });
  }
}

exports.deleteEventSummary = async (req, res) => {
  const { publicID } = req.params;

  try {
    await EQEventsService.clearEventSummary(publicID);

    return res.status(200).json({
      status: 0,
      message: 'Event summary reverted to auto-generated.',
    });
  } catch (error) {
    const statusCode = error.status ?? 500;
    return res.status(statusCode).json({
      status: 1,
      message: error.message || 'Failed to revert event summary.',
    });
  }
}