const AdminSystemService = require('../services/adminSystem.service');
const { responseCodes } = require('./responseCodes');

exports.getSnapshot = async (req, res, next) => {
  try {
    const snapshot = await AdminSystemService.getSnapshot(req);
    res.status(200).json({
      status: responseCodes.GENERIC_SUCCESS,
      message: 'Admin system resource snapshot retrieved successfully.',
      payload: snapshot,
    });
    res.message = 'Admin system resource snapshot retrieved successfully.';
  } catch (error) { next(error); }
};
