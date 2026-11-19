const { Types } = require('mongoose');
const SignificantEQs = require('../models/significantEQ.model');

exports.getAllSignificantEQs = async () => {
    const allSignificantEQs = await SignificantEQs.find({}).lean();
    // console.log('EQs:' + allSignificantEQs)
    // console.log(allSignificantEQs.length)

    if (allSignificantEQs.length === 0) {
        return {str: 'noSignificantEQsFound'};
    }

    return {
        str: 'success',
        significantEQs: allSignificantEQs
    };
}

exports.getEarthquakeInfo = async (id) => {
    if (!Types.ObjectId.isValid(id)) {
        return { str: 'invalidId' };
    }

    const earthquakeInfo = await SignificantEQs.findById(id).lean();
    // console.log('EQ Info:' + earthquakeInfo)

    if (!earthquakeInfo) {
        return {str: 'noEarthquakeInfoFound'};
    }

    return {
        str: 'success',
        earthquakeInfo: earthquakeInfo
    };
}
