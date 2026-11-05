const JobLocksRepo = require('../repositories/jobLocks.repo');

const parsePositiveInt = (raw, fallback) => {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const config = {
  enabled: String(process.env.JOB_LOCK_CLEANUP_ENABLED || 'true').toLowerCase() !== 'false',
  intervalMin: parsePositiveInt(process.env.JOB_LOCK_CLEANUP_INTERVAL_MIN, 60),
};

let cleanupTimer = null;

// Deletes expired job locks: PostgreSQL has no TTL index to do it, so this scheduled run replaces it
// (on MongoDB the TTL index does it too, and this finds nothing left).
async function runJobLockCleanup() {
  const now = new Date();
  const removedLocks = await JobLocksRepo.deleteExpired(now);
  return { removedLocks, intervalMin: config.intervalMin };
}

function startJobLockCleanupScheduler() {
  if (!config.enabled) {
    console.log('Job lock cleanup scheduler disabled by JOB_LOCK_CLEANUP_ENABLED=false');
    return;
  }
  if (cleanupTimer) return;

  const run = async () => {
    try {
      const result = await runJobLockCleanup();
      console.log(`[job-lock-cleanup] expiredLocks=${result.removedLocks}`);
    } catch (err) {
      console.error('[job-lock-cleanup] run failed:', err && (err.stack || err.message || err));
    }
  };

  // Run once shortly after startup; then continue on interval.
  setTimeout(run, 10 * 1000);
  cleanupTimer = setInterval(run, config.intervalMin * 60 * 1000);
  if (cleanupTimer && typeof cleanupTimer.unref === 'function') cleanupTimer.unref();
}

module.exports = {
  runJobLockCleanup,
  startJobLockCleanupScheduler,
};
