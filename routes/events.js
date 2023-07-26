/**
 * @swagger
 * components:
 *   schemas:
 *     Event:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           description: The auto-generated ObjectId of the event
 *         publicID:
 *           type: string
 *           description: The public ID of the event
 *         OT:
 *           type: string
 *           format: date-time
 *           description: The origin time of the event
 *         latitude_value:
 *           type: number
 *           description: The latitude value of the event
 *         longitude_value:
 *           type: number
 *           description: The longitude value of the event
 *         depth_value:
 *           type: number
 *           description: The depth value of the event
 *         magnitude_value:
 *           type: number
 *           description: The magnitude value of the event
 *         type:
 *           type: string
 *           description: The type of the event (NEW, UPDATE)
 *         text:
 *           type: string
 *           description: The text description of the event
 *         place:
 *           type: string
 *           description: The place of the event
 *       example:
 *         _id: 6151ec04b417ad001ff7d346
 *         publicID: event123
 *         OT: '2022-01-01T00:00:00.000Z'
 *         latitude_value: 40.123456
 *         longitude_value: -120.654321
 *         depth_value: 10
 *         magnitude_value: 5.7
 *         type: earthquake
 *         text: Mindoro, Philippines
 */

const express = require('express');
const router = express.Router();
const {getEventsList, addPlaces, addEQEvent} = require('../services/EQevents.service')

// query database
async function eventController(req, res, next) {
  try {
    // get data from db
    var data = await getEventsList(req.query.startTime, 
                                            req.query.endTime);
    // append regional data 
    var updatedData = await addPlaces(data)

    res.json(updatedData)

  }catch(err){
    console.trace(`While getting events from mysql...\n ${err}`);
    next(err)
  }
}

/**
 * @swagger
 * /eventsList:
 *   get:
 *     summary: Endpoint for getting recorded seismic events in the network within a specific time range
 *     tags:
 *       - Events
 *     parameters:
 *       - in: query
 *         name: startTime
 *         schema:
 *           type: string
 *           format: date-time
 *         description: The start time of the events (yyyy-MM-dd HH:mm:ss.S)
 *         required: true
 *         example: "2022-09-09 14:30:00.0"
 *       - in: query
 *         name: endTime
 *         schema:
 *           type: string
 *           format: date-time
 *         description: The start time of the events (yyyy-MM-dd HH:mm:ss.S)
 *         required: true
 *         example: "2023-09-09 14:30:00.0"
 *     responses:
 *       200:
 *         description: Successful response with events
 */
router.get('/', eventController);

module.exports = router;
