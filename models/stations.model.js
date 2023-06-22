const mongoose = require('mongoose');

const StationSchema = new mongoose.Schema({
  code: String,
  latitude:  Number,
  longitude: Number,
  description: String,
});

module.exports = mongoose.model('Station', StationSchema);
