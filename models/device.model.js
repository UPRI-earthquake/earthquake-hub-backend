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
