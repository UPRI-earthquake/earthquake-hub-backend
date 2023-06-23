const mongoose = require('mongoose');
const { Schema, model } = mongoose;

const DeviceSchema = new Schema({
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
    default: "Inactive",
  },
  lastConnectedTime: String
})

module.exports = model('Device', DeviceSchema);
