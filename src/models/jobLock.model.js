const mongoose = require('mongoose');

const jobLockSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, index: true },
    owner: { type: String, required: true },
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: true },
);

jobLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('JobLock', jobLockSchema);
