const AdminDeploymentHealthService = require('../services/adminDeploymentHealth.service');
const { responseCodes } = require('./responseCodes');

exports.getSnapshot = async (req, res, next) => {
  try {
    const snapshot = await AdminDeploymentHealthService.getSnapshot(req);
    res.status(200).json({
      status: responseCodes.GENERIC_SUCCESS,
      message: 'Deployment health snapshot retrieved successfully.',
      payload: snapshot,
    });
    res.message = 'Deployment health snapshot retrieved successfully.';
  } catch (error) { next(error); }
};
