const SignificantEQsService = require('../services/significantEQs.service')
const {responseCodes} = require('./responseCodes')

exports.getAllSignificantEQs = async (req, res, next) => {
    // Validation

    try {
        // Perform Task
        let returnObj = await SignificantEQsService.getAllSignificantEQs();

        //Respond based on returned value
        let message = "";

        switch (returnObj.str){
            case "noSignificantEQsFound":
                message = "No Significant Earthquakes found in DB!";
                res.status(400).json({
                    status: responseCodes.GENERIC_ERROR,
                    message: message
                });
                break;
            case "success":
                message = 'All Significant Earthquakes found';
                res.status(200).json({
                    status: responseCodes.GENERIC_SUCCESS,
                    message: message,
                    payload: returnObj.significantEQs
                });
                break;
            default:
                throw Error(`Unhandled return value ${returnObj} from service.getAllSignificantEQs()`);
        }

        res.message = message; // used by next middleware

        return;
    } catch (error) {
        console.log(`Getting all significant earthquakes unsuccessful: \n ${error}`);
        next(error);
    }
}

exports.getEarthquakeInfo = async (req, res, next) => {
    // Validation
    const { id } = req.body; // Check if the `id` query parameter is present

    try {
        // Perform Task
        let returnObj = await SignificantEQsService.getEarthquakeInfo(id);

        //Respond based on returned value
        let message = "";

        switch (returnObj.str){
            case "noEarthquakeInfoFound":
                message = "No Earthquake Information found in DB!";
                res.status(400).json({
                    status: responseCodes.GENERIC_ERROR,
                    message: message
                });
                break;
            case "success":
                message = 'Earthquake Information found';
                res.status(200).json({
                    status: responseCodes.GENERIC_SUCCESS,
                    message: message,
                    payload: returnObj.earthquakeInfo
                });
                break;
            default:
                throw Error(`Unhandled return value ${returnObj} from service.getEarthquakeInfo()`);
        }

        res.message = message; // used by next middleware

        return;
    } catch (error) {
        console.log(`Getting earthquake info unsuccessful: \n ${error}`);
        next(error);
    }
}