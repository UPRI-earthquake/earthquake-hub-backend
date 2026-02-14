const mongoose = require('mongoose');
const Subscription = require('../models/subscription.model');

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

async function runSubscriptionCleanup() {
  if (mongoose.connection.readyState !== 1) {
    return { skipped: true, reason: 'dbNotAccessible' };
  }

  const now = new Date();
  const staleCutoff = new Date(now.getTime() - config.staleDays * 24 * 60 * 60 * 1000);
  const invalidCleanupAfter = daysFromNow(config.invalidTtlDays, now);
  const nowEpoch = now.getTime();

  const [invalidatedExpired, invalidatedStale, removedDue] = await Promise.all([
    Subscription.updateMany(
      {
        status: { $ne: 'invalid' },
        expirationTime: { $type: 'number', $lte: nowEpoch },
      },
      {
        $set: {
          status: 'invalid',
          invalidatedAt: now,
          cleanupAfter: invalidCleanupAfter,
          lastFailureAt: now,
          lastFailureCode: 410,
        },
      },
    ),
    Subscription.updateMany(
      {
        status: 'active',
        lastSeenAt: { $lte: staleCutoff },
        consecutiveFailures: { $gte: config.failureThreshold },
      },
      {
        $set: {
          status: 'invalid',
          invalidatedAt: now,
          cleanupAfter: invalidCleanupAfter,
        },
      },
    ),
    // TTL handles this eventually, but explicit delete keeps collection tidy quickly.
    Subscription.deleteMany({
      status: 'invalid',
      cleanupAfter: { $type: 'date', $lte: now },
    }),
  ]);

  return {
    skipped: false,
    invalidatedExpired: invalidatedExpired.modifiedCount || 0,
    invalidatedStale: invalidatedStale.modifiedCount || 0,
    removedDue: removedDue.deletedCount || 0,
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
          `[notif-cleanup] expired=${result.invalidatedExpired} stale=${result.invalidatedStale} removed=${result.removedDue}`,
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

