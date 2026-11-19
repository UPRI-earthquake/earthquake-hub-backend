const express = require('express');
const router = express.Router();

const SignificantEQsController = require('../controllers/significantEQs.controller')
const { cacheSeconds } = require('../middlewares/cache.middleware')

// Significant EQs list is relatively stable; allow a longer cache window
router.route('/all').get(cacheSeconds(300),
    SignificantEQsController.getAllSignificantEQs
);

router.route('/').post(
    SignificantEQsController.getEarthquakeInfo
);


module.exports = router;
