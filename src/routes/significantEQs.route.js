const express = require('express');
const router = express.Router();

const SignificantEQsController = require('../controllers/significantEQs.controller')

router.route('/all').get(
    SignificantEQsController.getAllSignificantEQs
);


module.exports = router;
