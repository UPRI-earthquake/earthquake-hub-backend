const Joi = require('joi');
const AdminArchiveStorageService = require('../services/adminArchiveStorage.service');
const { responseCodes } = require('./responseCodes');

const snapshotSchema = Joi.object({
  windowHours: Joi.number().integer().min(1).max(168).default(24),
  limit: Joi.number().integer().min(1).max(100).default(50),
});

exports.getSnapshot = async (req, res, next) => {
  try {
    const { error, value } = snapshotSchema.validate(req.query, { stripUnknown: true });
    if (error) throw error;
    const snapshot = await AdminArchiveStorageService.getSnapshot(value, req);
    res.status(200).json({ status: responseCodes.GENERIC_SUCCESS, message: 'Archive and storage monitoring snapshot retrieved successfully.', payload: snapshot });
    res.message = 'Archive and storage monitoring snapshot retrieved successfully.';
  } catch (error) { next(error); }
};
