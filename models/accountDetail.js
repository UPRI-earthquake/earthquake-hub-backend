const mongoose = require('mongoose');

const { Schema, model } = mongoose;

const DeviceSchema = new Schema({
  streamId: String,
  network: String,
  station: String,
  elevation: String,
  location: String,
  activity: String,
  lastConnectedTime: String
})

module.exports = model('Device', DeviceSchema);
