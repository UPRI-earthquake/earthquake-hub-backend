const Joi = require('joi')
const EQEventsService = require('../services/EQevents.service')
const {responseCodes} = require('./responseCodes')
const {formatErrorMessage} = require('./helpers')

// query database
exports.getEQEvents = async (req, res, next) => {
  console.log('List of EQ events requested')
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
    const {startTime, endTime} = value
    // Perform Task
    // get data from db
    var data = await EQEventsService.getEventsList(startTime, endTime);
    // append regional data 
    var updatedData = await EQEventsService.addPlacesAttribute(data)

    // Respond based on returned values
    if(updatedData){
      res.status(200).json({
        status: responseCodes.GENERIC_SUCCESS,
        message: "EQ events acquired successfully",
        payload: updatedData
      });
    }
  }catch(err){
    console.trace(`Getting EQevents unsuccessful \n ${err}`);
    next(err)
  }
}
