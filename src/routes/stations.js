import express from 'express';
import { getStationLocations } from '../services/stations.js';

const router = express.Router();
/* GET stations */
router.get('/', async function (req, res, next) {
  try {
    res.json(await getStationLocations());
  } catch (err) {
    console.error('Error while getting stations', err.message);
    next(err)
  }
});

export default router;
