const express = require('express');
const router = express.Router();
const events = require('../services/events')

// query database
async function eventController(req, res, next) {
  try {
    // get data from db
    var data = await events.getEventsList(req.query.startTime, 
                                            req.query.endTime);
    // append regional data 
    var updatedData = await events.addPlaces(data)

    res.json(updatedData)

  }catch(err){
    console.trace(`While getting events from mysql...\n ${err}`);
    next(err)
  }
}

/* GET Events*/
router.get('/', eventController);

module.exports = router;
