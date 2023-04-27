const mongoose = require('mongoose');
const { Schema, model } = mongoose;

const DeviceSchema = new Schema({
  streamId: {
    type: String,
    required: true
  },
  network: {
    type: String,
    required: true
  },
  station: {
    type: String,
    required: true
  },
  location: {
    type: String,
    required: true
  },
  elevation: String,
  activity: {
    type: String,
    default: "Inactive"
  },
  lastConnectedTime: String
})

module.exports = model('Device', DeviceSchema);