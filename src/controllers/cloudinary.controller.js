const Joi = require('joi');
const CloudinaryService = require('../services/cloudinary.service');
const { responseCodes } = require('./responseCodes');
const { formatErrorMessage } = require('./helpers');

const signUploadSchema = Joi.object({
  publicId: Joi.string()
    .trim()
    .max(120)
    .pattern(/^[A-Za-z0-9_-]+$/)
    .optional()
    .messages({
      'string.max': 'publicId must be 120 characters or fewer.',
      'string.pattern.base': 'publicId may only contain letters, numbers, underscores, and hyphens.',
    }),
}).unknown(false);

exports.signCommentUpload = async (req, res, next) => {
  try {
    const { error, value } = signUploadSchema.validate(req.body || {}, { abortEarly: false });
    if (error) {
      return res.status(400).json({
        status: responseCodes.VALIDATION_ERROR,
        message: formatErrorMessage(error.details[0].message),
      });
    }

    const payload = CloudinaryService.createCommentUploadSignature({
      username: req.username,
      publicId: value.publicId,
    });

    const responseBody = {
      status: responseCodes.GENERIC_SUCCESS,
      message: 'Cloudinary upload signature generated',
      ...payload,
      payload,
    };

    res.status(200).json(responseBody);
    res.message = responseBody.message;
  } catch (error) {
    if (error?.name === 'CloudinarySignatureError') {
      return res.status(error.httpStatus || 500).json({
        status: error.httpStatus === 400 ? responseCodes.VALIDATION_ERROR : responseCodes.GENERIC_ERROR,
        message: error.message,
        errorCode: error.code,
      });
    }

    next(error);
  }
};
