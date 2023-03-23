const express = require('express');
const router = express.Router();
const stations = require('../services/stations')

/* GET stations */
router.get('/', async function (req, res, next) {
  try {
    res.json(await stations.getStationLocations());
  }catch(err){
    console.trace(`While getting stations from mysql...\n ${err}`);
    next(err)
  }
});

module.exports = router;
