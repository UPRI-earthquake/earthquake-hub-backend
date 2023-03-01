
import express from 'express';
import { getEventsList, addPlaces } from '../services/events.js';

const router = express.Router();


// query database
async function eventController(req, res, next) {
  try {
    // get data from db
    var data = await getEventsList(req.query.startTime,
      req.query.endTime);
    // append regional data 
    var updatedData = await addPlaces(data)

    res.json(updatedData)

  } catch (err) {
    console.error('Error while getting events', err.message);
    next(err)
  }
}

/* GET Events*/
router.get('/', eventController);

export default router;
