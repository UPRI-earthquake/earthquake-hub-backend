/**
  * @swagger
  * components:
  *   schemas:
  *     Device:
  *       type: object
  *       properties:
  *         _id:
  *           type: string
  *           description: The auto-generated ObjectId of the device
  *         description:
  *           type: string
  *           description: The description of the device
  *         streamId:
  *           type: string
  *           description: The stream ID of the device (e.g. AM_RE722\.*\/MSEED)
  *           pattern: '^[A-Z]{2}_[A-Z0-9]{5}_\.\*\/MSEED$'
  *         network:
  *           type: string
  *           description: The network of the device
  *         station:
  *           type: string
  *           description: The station of the device
  *         latitude:
  *           type: number
  *           description: The latitude of the device
  *         longitude:
  *           type: number
  *           description: The longitude of the device
  *         elevation:
  *           type: number
  *           description: The elevation of the device
  *         macAddress:
  *           type: string
  *           description: The MAC address of the device
  *           pattern: '^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$'
  *         activity:
  *           type: string
  *           description: The activity status of the device (active, inactive, INTERNAL_ERROR)
  *         activityToggleTime:
  *           type: string
  *           format: date-time
  *           description: The time when the device's activity last changed
  */

const mongoose = require('mongoose');
const { Schema, model } = mongoose;

const DeviceSchema = new Schema({
  description: {
    type: String
  },
  streamId: {
    type: String,
    default: "TO_BE_LINKED"
  },
  network: {
    type: String,
    required:true
  },
  station: {
    type: String,
    required:true
  },
  latitude: {
    type: Number,
    required:true
  },
  longitude: {
    type: Number,
    required:true
  },
  elevation: {
    type: Number,
    required:true
  },
  macAddress: {
    type: String,
    default: "TO_BE_LINKED"
  },
  activity: {
    type: String,
    default: "inactive",
  },
  activityToggleTime: {
    type: Date,
    default: new Date(0),
  }
})

module.exports = model('Device', DeviceSchema);
