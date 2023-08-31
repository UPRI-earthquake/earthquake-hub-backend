/**
  * @swagger
  * components:
  *   schemas:
  *     Event:
  *       type: object
  *       properties:
  *         _id:
  *           type: string
  *           description: Auto-generated ObjectId (from SeisComP) of the event
  *         publicID:
  *           type: string
  *           description: SeisComP public ID of the event
  *         OT:
  *           type: string
  *           format: date-time
  *           description: Origin time of the event
  *         latitude_value:
  *           type: number
  *           description: Latitude value of the event
  *         longitude_value:
  *           type: number
  *           description: Longitude value of the event
  *         depth_value:
  *           type: number
  *           description: Depth value of the event
  *         magnitude_value:
  *           type: number
  *           description: Magnitude value of the event
  *         type:
  *           type: string
  *           description: >
  *              * `NEW`  - Newly created event object from SeisComP
  *              * `UPDATE` - An update of previously created event object
  *         text:
  *           type: string
  *           description: SeisComP's derived place name for the event
  *         place:
  *           type: string
  *           description: An attribute added later-on via geoserve API
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

const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
  publicID: String,
  OT: Date,
  latitude_value: Number,
  longitude_value: Number,
  depth_value: Number,
  magnitude_value: Number,
  type: String,
  text: String,
  place: String
});

module.exports = mongoose.model('Event', eventSchema);
