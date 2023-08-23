const Joi = require('joi')
const NotificationsService = require('../services/notifications.service')
const {responseCodes} = require('./responseCodes')
const {formatErrorMessage} = require('./helpers')

exports.subscribe = async (req, res, next) => {
  // Define validation Schema
  const subscriptionSchema = Joi.object({
    endpoint: Joi.string()
      .uri()
      .required()
      .messages({
        "any.required": "Endpoint is required.",
        "string.uri": "Endpoint must be a valid URI.",
      }),
    expirationTime: Joi.date()
      .allow(null)
      .optional()
      .messages({
        "date.base": "Expiration time must be a valid date.",
      }),
    keys: Joi.object({
      p256dh: Joi.string()
        .required()
        .messages({
          "any.required": "p256dh key is required.",
        }),
      auth: Joi.string()
        .required()
        .messages({
          "any.required": "Auth key is required.",
        }),
    }).required(),
  });

  try {

    // Validate POST input
    const {error, value} = subscriptionSchema.validate(req.body, {abortEarly: false})
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
