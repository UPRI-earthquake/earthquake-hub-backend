const mongoose = require('mongoose');

const senderTunnelObservationSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true, uppercase: true, trim: true, maxlength: 64 },
  connected: { type: Boolean, required: true },
  remotePort: { type: Number, min: 1, max: 65535, default: null },
  senderStateUpdatedAt: Date,
  senderLastConnectedAt: Date,
  senderReportedAt: { type: Date, required: true },
  receivedAt: { type: Date, required: true, default: Date.now, index: true },
  errorCode: { type: String, maxlength: 64, default: null },
  errorMessage: { type: String, maxlength: 280, default: null },
}, { timestamps: true });

senderTunnelObservationSchema.index({ receivedAt: -1 });
module.exports = mongoose.model('SenderTunnelObservation', senderTunnelObservationSchema);
