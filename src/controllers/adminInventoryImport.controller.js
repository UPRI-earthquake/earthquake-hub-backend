const AdminInventoryImportService = require('../services/adminInventoryImport.service');
const { responseCodes } = require('./responseCodes');

exports.getWorkflow = async (_req, res, next) => {
  try {
    const workflow = await AdminInventoryImportService.getWorkflow();
    res.status(200).json({ status: responseCodes.GENERIC_SUCCESS, message: 'SeisComP inventory import workflow retrieved successfully.', payload: workflow });
    res.message = 'SeisComP inventory import workflow retrieved successfully.';
  } catch (error) { next(error); }
};
