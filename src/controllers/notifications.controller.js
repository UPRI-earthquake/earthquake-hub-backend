const Joi = require('joi')
const NotificationsService = require('../services/notifications.service')
const {responseCodes} = require('./responseCodes')

exports.subscribe = async (req, res, next) => {
  // Define validation Schema
  const subscriptionSchema = Joi.object({
    endpoint: Joi.string().uri().required(),
    expirationTime: Joi.date().allow(null).optional(),
    keys: Joi.object({
      p256dh: Joi.string().required(),
      auth: Joi.string().required()
    }).required()
  });

  try {

    // Validate POST input
    const {error, value} = subscriptionSchema.validate(req.body)
    if(error){
      console.log(error.details[0].message)
      res.status(400).json({
        status: responseCodes.GENERIC_ERROR,
        message: error.details[0].message
      });
      return;
    }

    // Perform Task
    let returnStr = await NotificationsService.createSubscription(value);
    console.log('after createSubscription');

    // Respond based on returned value
    switch(returnStr){
      case 'success':
        res.status(201).json({
          status: responseCodes.GENERIC_SUCCESS,
          message: "Subscription created"
        })
        break;
      case 'subscriptionExists':
        res.status(200).json({
          status: responseCodes.GENERIC_SUCCESS,
          message: "Subscription already exists"
        })
        break;
      case 'dbNotAccessible':
        res.status(400).json({
          status: responseCodes.GENERIC_ERROR,
          message: "Internal error encountered"
        })
        break;
      default:
        throw Error(`Unhandled return value ${returnStr} from service.createSubscription()`)
    }
  } catch (error) {
    console.log(`Adding new pick unsuccessful: \n ${error}`);
    next(error)
  }
}
