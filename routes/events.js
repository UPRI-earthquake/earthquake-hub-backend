const express = require('express');
const router = express.Router();
const events = require('../services/events')

/* GET Events*/
router.get('/', async function (req, res, next) {
  try {
    res.json(await events.getEventsList(req.query.startTime,
    req.query.endTime));
  }catch(err){
    console.error('Error while getting events', err.message);
    next(err)
  }
});

module.exports = router;
