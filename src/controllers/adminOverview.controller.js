const AdminOverviewService = require('../services/adminOverview.service');
const { responseCodes } = require('./responseCodes');

exports.getSnapshot = async (req, res, next) => {
  try {
    const snapshot = await AdminOverviewService.getSnapshot(req);
    res.status(200).json({
      status: responseCodes.GENERIC_SUCCESS,
      message: 'Admin overview snapshot retrieved successfully.',
      payload: snapshot,
    });
    res.message = 'Admin overview snapshot retrieved successfully.';
  } catch (error) { next(error); }
};
