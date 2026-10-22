const PushSubscriptionsRepo = require('../repositories/pushSubscriptions.repo');
const JobLocksRepo = require('../repositories/jobLocks.repo');

const parsePositiveInt = (raw, fallback) => {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const config = {
  enabled: String(process.env.NOTIF_CLEANUP_ENABLED || 'true').toLowerCase() !== 'false',
  intervalMin: parsePositiveInt(process.env.NOTIF_CLEANUP_INTERVAL_MIN, 60),
  staleDays: parsePositiveInt(process.env.NOTIF_STALE_DAYS, 90),
  failureThreshold: parsePositiveInt(process.env.NOTIF_FAILURE_THRESHOLD, 3),
  invalidTtlDays: parsePositiveInt(process.env.NOTIF_INVALID_TTL_DAYS, 7),
};

let cleanupTimer = null;

const daysFromNow = (days, now = new Date()) => {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
};

// Also deletes expired job locks: in PostgreSQL there's no TTL index to do it, so this scheduled run
// replaces it for both push subscriptions and locks.
async function runSubscriptionCleanup() {
  if (!(await PushSubscriptionsRepo.isAvailable())) {
    return { skipped: true, reason: 'dbNotAccessible' };
  }

  const now = new Date();
  const staleCutoff = new Date(now.getTime() - config.staleDays * 24 * 60 * 60 * 1000);
  const invalidCleanupAfter = daysFromNow(config.invalidTtlDays, now);

  const [invalidatedExpired, invalidatedStale, removedDue, removedLocks] = await Promise.all([
    PushSubscriptionsRepo.markExpiredInvalid({ cleanupAfter: invalidCleanupAfter, now }),
    PushSubscriptionsRepo.markStaleInvalid({
      staleCutoff,
      failureThreshold: config.failureThreshold,
      cleanupAfter: invalidCleanupAfter,
      now,
    }),
    PushSubscriptionsRepo.deleteExpired(now),
    JobLocksRepo.deleteExpired(now),
  ]);

  return {
    skipped: false,
    invalidatedExpired,
    invalidatedStale,
    removedDue,
    removedLocks,
    staleCutoff,
    intervalMin: config.intervalMin,
  };
}

function startSubscriptionCleanupScheduler() {
  if (!config.enabled) {
    console.log('Subscription cleanup scheduler disabled by NOTIF_CLEANUP_ENABLED=false');
    return;
  }
  if (cleanupTimer) return;

  const run = async () => {
    try {
      const result = await runSubscriptionCleanup();
      if (!result.skipped) {
        console.log(
          `[notif-cleanup] expired=${result.invalidatedExpired} stale=${result.invalidatedStale} removed=${result.removedDue} expiredLocks=${result.removedLocks}`,
        );
      }
    } catch (err) {
      console.error('[notif-cleanup] run failed:', err && (err.stack || err.message || err));
    }
  };

  // Run once shortly after startup; then continue on interval.
  setTimeout(run, 10 * 1000);
  cleanupTimer = setInterval(run, config.intervalMin * 60 * 1000);
  if (cleanupTimer && typeof cleanupTimer.unref === 'function') cleanupTimer.unref();
}

module.exports = {
  runSubscriptionCleanup,
  startSubscriptionCleanupScheduler,
};

