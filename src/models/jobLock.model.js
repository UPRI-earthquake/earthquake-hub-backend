const mongoose = require('mongoose');

const jobLockSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true }, // unique implies an index
    owner: { type: String, required: true },
    // Indexed only by the TTL index below. Don't add `index: true` here: a plain index on the
    // same key takes the name expiresAt_1 first, and the TTL index then silently fails to build.
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// MongoDB deletes a lock once expiresAt has passed. acquireJobLock() also treats expired
// locks as free, so locking works even before the TTL monitor (runs every ~60s) removes them.
jobLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('JobLock', jobLockSchema);
