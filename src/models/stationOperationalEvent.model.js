const mongoose = require('mongoose');
const {
  getStationHistoryRetentionDays,
  resolveStationHistoryRetention,
} = require('../config/stationHistoryRetention.config');

const EVENT_TYPES = ['activity_changed', 'tunnel_enrolled', 'tunnel_revoked'];
const SOURCES = ['ringserver_stream_status', 'tunnel_registry_action'];

const stationOperationalEventSchema = new mongoose.Schema(
  {
    deviceId: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      maxlength: 64,
      index: true,
    },
    network: { type: String, uppercase: true, trim: true, maxlength: 10 },
    station: { type: String, uppercase: true, trim: true, maxlength: 10 },
    eventType: {
      type: String,
      enum: EVENT_TYPES,
      required: true,
      index: true,
    },
    source: {
      type: String,
      enum: SOURCES,
      required: true,
      index: true,
    },
    observedAt: { type: Date, required: true, index: true },
    effectiveAt: Date,
    fromState: {
      activity: { type: String, trim: true, maxlength: 32 },
      tunnelMapping: { type: String, enum: ['mapped', 'unmapped'] },
    },
    toState: {
      activity: { type: String, trim: true, maxlength: 32 },
      tunnelMapping: { type: String, enum: ['mapped', 'unmapped'] },
    },
    evidence: {
      streamId: { type: String, trim: true, maxlength: 256 },
      latestPacketAt: Date,
      packetAgeMs: { type: Number, min: 0 },
      inactivityThresholdMs: { type: Number, min: 0 },
      remotePort: { type: Number, min: 1, max: 65535 },
    },
    actor: {
      accountId: { type: String, trim: true, maxlength: 128 },
      username: { type: String, trim: true, maxlength: 254 },
      role: { type: String, trim: true, maxlength: 64 },
    },
    correlationId: { type: String, trim: true, maxlength: 128, index: true },
    retentionDays: {
      type: Number,
      min: 1,
      max: 3650,
      default: () => getStationHistoryRetentionDays(),
    },
    expiresAt: {
      type: Date,
      required: true,
      default: () => resolveStationHistoryRetention().expiresAt,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

stationOperationalEventSchema.index({ deviceId: 1, observedAt: -1, _id: -1 });
stationOperationalEventSchema.index({ deviceId: 1, eventType: 1, observedAt: -1 });
stationOperationalEventSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

stationOperationalEventSchema.pre('save', function rejectDocumentMutation() {
  if (!this.isNew) {
    throw new Error('StationOperationalEvent records are immutable. Append a new event instead.');
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
  stationOperationalEventSchema.pre(operation, function rejectMutation() {
    throw new Error('StationOperationalEvent records are immutable. Append a new event instead.');
  });
});

const StationOperationalEvent = mongoose.model('StationOperationalEvent', stationOperationalEventSchema);
StationOperationalEvent.EVENT_TYPES = EVENT_TYPES;
StationOperationalEvent.SOURCES = SOURCES;

module.exports = StationOperationalEvent;
