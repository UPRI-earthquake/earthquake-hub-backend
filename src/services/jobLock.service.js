const os = require('os');
const process = require('process');
const JobLocksRepo = require('../repositories/jobLocks.repo');

const DEFAULT_LOCK_TTL_MS = 60 * 60 * 1000;

function getLockOwner() {
  return `${os.hostname()}:${process.pid}`;
}

async function acquireJobLock(name, ttlMs = DEFAULT_LOCK_TTL_MS) {
  const owner = getLockOwner();
  const { acquired, expiresAt } = await JobLocksRepo.acquire(name, owner, ttlMs);

  return {
    acquired,
    name,
    owner,
    expiresAt,
    async release() {
      await JobLocksRepo.release(name, owner);
    },
  };
}

module.exports = {
  acquireJobLock,
};
