const SignificantEQsService = require('../services/significantEQs.service');
const { responseCodes } = require('./responseCodes');

// Sends a response and keeps its message for the response logger
const send = (res, httpStatus, status, message, extra = {}) => {
  res.status(httpStatus).json({ status, message, ...extra });
  res.message = message;
};

exports.getAllSignificantEQs = async (req, res, next) => {
  try {
    const significantEQs = await SignificantEQsService.getAllSignificantEQs();
    send(res, 200, responseCodes.GENERIC_SUCCESS,
      significantEQs.length > 0 ? 'All Significant Earthquakes found' : 'No significant earthquakes yet',
      { payload: significantEQs });
  } catch (error) {
    console.log(`Getting all significant earthquakes unsuccessful: \n ${error}`);
    next(error);
  }
};

exports.getEarthquakeInfo = async (req, res, next) => {
  try {
    const result = await SignificantEQsService.getEarthquakeInfo((req.body || {}).id);
    switch (result.str) {
      case 'invalidId':
        return send(res, 400, responseCodes.VALIDATION_ERROR, 'Invalid earthquake id');
      case 'notFound':
        return send(res, 404, responseCodes.GENERIC_ERROR, 'No Earthquake Information found');
      case 'success':
        return send(res, 200, responseCodes.GENERIC_SUCCESS, 'Earthquake Information found', { payload: result.earthquakeInfo });
      default:
        throw Error(`Unhandled return value ${result.str} from service.getEarthquakeInfo()`);
    }
  } catch (error) {
    console.log(`Getting earthquake info unsuccessful: \n ${error}`);
    return next(error);
  }
};

exports.setDetails = async (req, res, next) => {
  try {
    const result = await SignificantEQsService.setDetails(req.params.id, req.body, req.username);
    switch (result.str) {
      case 'invalidId':
        return send(res, 400, responseCodes.VALIDATION_ERROR, 'Invalid earthquake id');
      case 'invalidDetails':
        return send(res, 400, responseCodes.VALIDATION_ERROR, result.message);
      case 'notFound':
        return send(res, 404, responseCodes.GENERIC_ERROR, 'No Earthquake Information found');
      case 'success':
        return send(res, 200, responseCodes.GENERIC_SUCCESS, 'Earthquake details saved', { payload: result.details });
      default:
        throw Error(`Unhandled return value ${result.str} from service.setDetails()`);
    }
  } catch (error) {
    console.log(`Saving earthquake details unsuccessful: \n ${error}`);
    return next(error);
  }
};

exports.removeDetails = async (req, res, next) => {
  try {
    const result = await SignificantEQsService.removeDetails(req.params.id);
    switch (result.str) {
      case 'invalidId':
        return send(res, 400, responseCodes.VALIDATION_ERROR, 'Invalid earthquake id');
      case 'notFound':
        return send(res, 404, responseCodes.GENERIC_ERROR, 'No Earthquake Information found');
      case 'noDetails':
        return send(res, 404, responseCodes.GENERIC_ERROR, 'This earthquake has no details to remove');
      case 'success':
        return send(res, 200, responseCodes.GENERIC_SUCCESS, 'Earthquake details removed');
      default:
        throw Error(`Unhandled return value ${result.str} from service.removeDetails()`);
    }
  } catch (error) {
    console.log(`Removing earthquake details unsuccessful: \n ${error}`);
    return next(error);
  }
};
