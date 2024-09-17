const SignificantEQs = require('../models/significantEQ.model');

exports.getAllSignificantEQs = async () => {
    const allSignificantEQs = await SignificantEQs.find({});
    console.log('EQs:' + allSignificantEQs)
    console.log(allSignificantEQs.length)

    if (allSignificantEQs.length === 0) {
        return {str: 'noSignificantEQsFound'};
    }

    return {
        str: 'success',
        significantEQs: allSignificantEQs
    };
}

exports.getEarthquakeInfo = async (id) => {
    const earthquakeInfo = await SignificantEQs.findById(id);
    console.log('EQ Info:' + earthquakeInfo)

    if (!earthquakeInfo) {
        return {str: 'noSignificantEQsFound'};
    }

    return {
        str: 'success',
        earthquakeInfo: earthquakeInfo
    };
}