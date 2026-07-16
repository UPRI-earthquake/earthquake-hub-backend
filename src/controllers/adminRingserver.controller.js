const Joi = require('joi');
const AdminRingserverService = require('../services/adminRingserver.service');
const { responseCodes } = require('./responseCodes');

const snapshotSchema = Joi.object({
  connectionLimit: Joi.number().integer().min(1).max(250).default(100),
  streamLimit: Joi.number().integer().min(1).max(500).default(200),
});

exports.getSnapshot = async (req, res, next) => {
  try {
    const { error, value } = snapshotSchema.validate(req.query, { stripUnknown: true });
    if (error) throw error;
    const snapshot = await AdminRingserverService.getSnapshot(value);
    res.status(200).json({ status: responseCodes.GENERIC_SUCCESS, message: 'Ringserver monitoring snapshot retrieved successfully.', payload: snapshot });
    res.message = 'Ringserver monitoring snapshot retrieved successfully.';
  } catch (error) {
    if (error?.name === 'RingserverMonitoringError') {
      return res.status(502).json({ status: responseCodes.GENERIC_ERROR, message: error.message });
    }
    next(error);
  }
};
