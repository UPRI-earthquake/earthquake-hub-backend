const mongoose = require('mongoose');
const { Schema, model } = mongoose;

const DeviceSchema = new Schema({
  streamId: {
    type: String
  },
  network: {
    type: String
  },
  station: {
    type: String
  },
  location: {
    type: String
  },
  elevation: String,
  macAddress: String,
  activity: {
    type: String,
    default: "Inactive"
  },
  lastConnectedTime: String
})

module.exports = model('Device', DeviceSchema);
