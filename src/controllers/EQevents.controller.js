const Joi = require('joi')
const EQEventsService = require('../services/EQevents.service')
const {responseCodes} = require('../routes/responseCodes')

// query database
exports.getEQEvents = async (req, res, next) => {
  console.log('List of EQ events requested')
  // Define validation schema
  const schema = Joi.object({
    startTime: Joi.date().iso().required(),
    endTime: Joi.date().iso().required(),
  });

  try {
    // Validate query
    const {error, value} = schema.validate(req.query)
    if(error){
      console.log(error.details[0].message)
      res.status(400).json({
        status: responseCodes.GENERIC_ERROR,
        message: error.details[0].message
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
