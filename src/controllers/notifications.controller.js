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
    expirationTime: Joi.alternatives()
      .try(
        Joi.number(),
        Joi.date(),
        Joi.valid(null),
      )
      .optional(),
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
    clientMeta: Joi.object({
      swScriptUrl: Joi.string().uri().optional(),
      userAgent: Joi.string().max(500).optional(),
      appVersion: Joi.string().max(80).optional(),
      time: Joi.alternatives().try(Joi.date(), Joi.number(), Joi.string()).optional(),
    }).optional(),
  });

  try {
    // Validate POST input
    const {error, value} = subscriptionSchema.validate(req.body, {abortEarly: false})
    if(error){ throw error }

    // Perform Task
    let returnStr = await NotificationsService.createSubscription(value);
    console.log('after createSubscription');

    // Respond based on returned value
    let message = "";
    
    switch (returnStr) {
      case 'success':
        message = 'Subscription created';
        res.status(201).json({
          status: responseCodes.GENERIC_SUCCESS,
          message: message
        });
        break;
      case 'subscriptionExists':
        message = 'Subscription already exists';
        res.status(200).json({
          status: responseCodes.GENERIC_SUCCESS,
          message: message
        });
        break;
      case 'dbNotAccessible':
        message = 'Internal error encountered';
        res.status(400).json({
          status: responseCodes.GENERIC_ERROR,
          message: message
        });
        break;
      default:
        throw Error(`Unhandled return value ${returnStr} from service.createSubscription()`);
    }
    
    res.message = message; // used by next middleware

    return;
  } catch (error) {
    console.log(`Adding new pick unsuccessful: \n ${error}`);
    next(error)
  }
}
