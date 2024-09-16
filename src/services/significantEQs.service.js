const SignificantEQs = require('../models/significantEQ.model');

exports.getAllSignificantEQs = async () => {
    console.log(SignificantEQs);
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