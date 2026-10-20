const SignificantEqsRepo = require('../repositories/significantEqs.repo');

exports.getAllSignificantEQs = async () => {
    const allSignificantEQs = await SignificantEqsRepo.findAll();
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
    if (!SignificantEqsRepo.isValidId(id)) {
        return { str: 'invalidId' };
    }

    const earthquakeInfo = await SignificantEqsRepo.findById(id);
    // console.log('EQ Info:' + earthquakeInfo)

    if (!earthquakeInfo) {
        return {str: 'noEarthquakeInfoFound'};
    }

    return {
        str: 'success',
        earthquakeInfo: earthquakeInfo
    };
}
