const Joi = require('joi');
const AdminGlobalSearchService = require('../services/adminGlobalSearch.service');
const { responseCodes } = require('./responseCodes');

const searchSchema = Joi.object({
  q: Joi.string().trim().min(2).max(100).required(),
  limit: Joi.number().integer().min(1).max(5).default(4),
});

exports.search = async (req, res, next) => {
  try {
    const { error, value } = searchSchema.validate(req.query, { stripUnknown: true });
    if (error) throw error;
    const result = await AdminGlobalSearchService.search(value.q, { limit: value.limit });
    res.status(200).json({
      status: responseCodes.GENERIC_SUCCESS,
      message: result.partial
        ? 'Global search completed with partial results.'
        : 'Global search completed successfully.',
      payload: result,
    });
    res.message = result.partial
      ? 'Global search completed with partial results.'
      : 'Global search completed successfully.';
  } catch (error) {
    next(error);
  }
};
