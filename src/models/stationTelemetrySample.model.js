const mongoose = require('mongoose');
const {
  getStationTelemetryRetentionDays,
  getStationTelemetrySampleIntervalSeconds,
  resolveStationTelemetryRetention,
} = require('../config/stationTelemetry.config');

const stationTelemetrySampleSchema = new mongoose.Schema(
  {
    deviceId: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      maxlength: 64,
    },
    network: { type: String, uppercase: true, trim: true, maxlength: 10 },
    station: { type: String, uppercase: true, trim: true, maxlength: 10 },
    source: {
      type: String,
      enum: ['ringserver_stream_status'],
      required: true,
      default: 'ringserver_stream_status',
    },
    observedAt: { type: Date, required: true },
    bucketAt: { type: Date, required: true },
    latestPacketAt: { type: Date, required: true },
    packetAgeMs: { type: Number, required: true, min: 0 },
    inactivityThresholdMs: { type: Number, required: true, min: 0 },
    activity: { type: String, enum: ['active', 'inactive'], required: true },
    streamRowCount: { type: Number, required: true, min: 1, max: 10000 },
    sampleIntervalSeconds: {
      type: Number,
      min: 60,
      max: 86400,
      default: () => getStationTelemetrySampleIntervalSeconds(),
    },
    retentionDays: {
      type: Number,
      min: 1,
      max: 3650,
      default: () => getStationTelemetryRetentionDays(),
    },
    expiresAt: {
      type: Date,
      required: true,
      default: () => resolveStationTelemetryRetention().expiresAt,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

stationTelemetrySampleSchema.index({ deviceId: 1, bucketAt: 1 }, { unique: true });
stationTelemetrySampleSchema.index({ deviceId: 1, observedAt: -1, _id: -1 });
stationTelemetrySampleSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

stationTelemetrySampleSchema.pre('save', function rejectDocumentMutation() {
  if (!this.isNew) {
    throw new Error('StationTelemetrySample records are immutable. Append a new sample instead.');
  }
});

[
  'deleteMany',
  'deleteOne',
  'findOneAndDelete',
  'findOneAndReplace',
  'findOneAndUpdate',
  'replaceOne',
  'updateMany',
  'updateOne',
].forEach((operation) => {
  stationTelemetrySampleSchema.pre(operation, function rejectMutation() {
    throw new Error('StationTelemetrySample records are immutable. Append a new sample instead.');
  });
});

module.exports = mongoose.model('StationTelemetrySample', stationTelemetrySampleSchema);
