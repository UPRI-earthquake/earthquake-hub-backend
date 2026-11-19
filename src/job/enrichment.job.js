const cron = require('node-cron');
const {
  addAdditionalInformation,
  countEligibleEnrichmentEvents,
} = require('../services/EQevents.service');
const { acquireJobLock } = require('../services/jobLock.service');

function positiveNumberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// Runs every day at 02:00 server time. At that hour external catalogs
// (PHIVOLCS, USGS) are unlikely to be under heavy load and any event
// ingested the previous day will comfortably exceed the minimum age window.
//
// To change the schedule, set the ENRICHMENT_CRON env var using standard
// cron syntax, e.g.:
//   "0 2 * * *"   → every day at 02:00  (default)
//   "0 2 */2 * *" → every other day at 02:00
//   "0 */6 * * *" → every 6 hours
const ENRICHMENT_CRON = process.env.ENRICHMENT_CRON || '0 2 * * *';
const ENRICHMENT_LOCK_TTL_MS = positiveNumberEnv('ENRICHMENT_LOCK_TTL_MS', 60 * 60 * 1000);
const ENRICHMENT_RUN_ON_STARTUP = String(process.env.ENRICHMENT_RUN_ON_STARTUP || 'false').toLowerCase() === 'true';
const ENRICHMENT_STARTUP_DELAY_MS = positiveNumberEnv('ENRICHMENT_STARTUP_DELAY_MS', 30_000);
const ENRICHMENT_JOB_LOCK_NAME = 'additional-information-enrichment';

let isRunning = false;

async function runEnrichment(trigger = 'scheduled') {
  if (isRunning) {
    console.log(`[enrichment] skipping ${trigger} run — previous run is still in progress`);
    return;
  }

  isRunning = true;
  let lock = null;
  console.log(`[enrichment] starting ${trigger} run at ${new Date().toISOString()}`);

  try {
    lock = await acquireJobLock(ENRICHMENT_JOB_LOCK_NAME, ENRICHMENT_LOCK_TTL_MS);
    if (!lock.acquired) {
      console.log(`[enrichment] skipping ${trigger} run — another backend instance holds the job lock`);
      return;
    }

    const result = await addAdditionalInformation();
    console.log(
      `[enrichment] completed at ${new Date().toISOString()} — ` +
      `modified=${result.modifiedCount} completed=${result.completedCount} ` +
      `partial=${result.partialCount} noMatch=${result.noMatchCount} ` +
      `skipped=${result.skippedCount} exhausted=${result.exhaustedCount} ` +
      `failedSources=${result.failedSourceCount} total=${result.totalProcessed}`
    );
  } catch (err) {
    console.error(`[enrichment] job failed at ${new Date().toISOString()} — ${err.message}`);
    console.error(err.stack);
  } finally {
    if (lock?.acquired) {
      try {
        await lock.release();
      } catch (err) {
        console.error(`[enrichment] failed to release job lock — ${err.message}`);
      }
    }
    isRunning = false;
  }
}

async function runStartupCatchUp() {
  try {
    const eligibleCount = await countEligibleEnrichmentEvents();
    if (eligibleCount === 0) {
      console.log('[enrichment] startup catch-up skipped — no eligible events');
      return;
    }

    console.log(`[enrichment] startup catch-up found ${eligibleCount} eligible event(s)`);
    await runEnrichment('startup catch-up');
  } catch (err) {
    console.error(`[enrichment] startup catch-up failed — ${err.message}`);
    console.error(err.stack);
  }
}

function startEnrichmentScheduler() {
  if (!cron.validate(ENRICHMENT_CRON)) {
    console.error(`[enrichment] invalid cron expression "${ENRICHMENT_CRON}" — scheduler not started`);
    return;
  }

  cron.schedule(ENRICHMENT_CRON, () => runEnrichment('scheduled'), {
    timezone: process.env.TZ || 'Asia/Manila',
  });

  console.log(`[enrichment] scheduler registered — cron="${ENRICHMENT_CRON}" tz=${process.env.TZ || 'Asia/Manila'}`);

  if (ENRICHMENT_RUN_ON_STARTUP) {
    setTimeout(runStartupCatchUp, ENRICHMENT_STARTUP_DELAY_MS);
    console.log(`[enrichment] startup catch-up enabled — delay=${ENRICHMENT_STARTUP_DELAY_MS}ms`);
  }
}

module.exports = { startEnrichmentScheduler, runEnrichment, runStartupCatchUp };
