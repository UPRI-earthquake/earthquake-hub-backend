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