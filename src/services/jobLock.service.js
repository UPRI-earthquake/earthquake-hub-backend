const os = require('os');
const process = require('process');
const JobLock = require('../models/jobLock.model');

const DEFAULT_LOCK_TTL_MS = 60 * 60 * 1000;

function getLockOwner() {
  return `${os.hostname()}:${process.pid}`;
}

async function acquireJobLock(name, ttlMs = DEFAULT_LOCK_TTL_MS) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  const owner = getLockOwner();

  let lock = null;
  try {
    lock = await JobLock.findOneAndUpdate(
      {
        name,
        $or: [
          { expiresAt: { $lte: now } },
          { owner },
        ],
      },
      { $set: { name, owner, expiresAt } },
      { upsert: true, new: true },
    );
  } catch (err) {
    if (err.code !== 11000) throw err;
  }

  const acquired = Boolean(lock && lock.owner === owner);

  return {
    acquired,
    name,
    owner,
    expiresAt,
    async release() {
      await JobLock.deleteOne({ name, owner });
    },
  };
}

module.exports = {
  acquireJobLock,
};
