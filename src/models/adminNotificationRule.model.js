const mongoose = require('mongoose');

const adminNotificationRuleSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, trim: true, maxlength: 96 },
  version: { type: Number, required: true, default: 0, min: 0 },
  enabled: { type: Boolean, required: true, default: false },
  cooldownMinutes: { type: Number, required: true, default: 60, min: 5, max: 1440 },
}, { timestamps: true });

module.exports = mongoose.model('AdminNotificationRule', adminNotificationRuleSchema);
