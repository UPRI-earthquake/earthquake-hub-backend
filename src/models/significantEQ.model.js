const mongoose = require('mongoose');

const SignificantEQsSchema = new mongoose.Schema({
    title: String,
    magnitude: Number,
    longitude: Number,
    latitude: Number,
    depth: Number,
    location: String,
    eventTime: Date,
    instrumentRecordings: Array,
    eventSummary: String,
    references: Array
});

module.exports = mongoose.model('significant-eq', SignificantEQsSchema);