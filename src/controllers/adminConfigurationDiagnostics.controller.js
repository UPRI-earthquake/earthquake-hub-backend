const AdminConfigurationDiagnosticsService = require('../services/adminConfigurationDiagnostics.service');
const { responseCodes } = require('./responseCodes');

exports.getSnapshot = async (req, res, next) => {
  try {
    const snapshot = AdminConfigurationDiagnosticsService.getSnapshot();
    res.status(200).json({
      status: responseCodes.GENERIC_SUCCESS,
      message: 'Configuration diagnostics retrieved successfully.',
      payload: snapshot,
    });
    res.message = 'Configuration diagnostics retrieved successfully.';
  } catch (error) { next(error); }
};
