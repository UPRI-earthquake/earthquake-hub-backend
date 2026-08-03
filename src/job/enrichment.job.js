const cron = require('node-cron');
const crypto = require('crypto');
const {
  countEligibleEnrichmentEvents,
} = require('../services/EQevents.service');
const AdminJobService = require('../services/adminJob.service');

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
const ENRICHMENT_RUN_ON_STARTUP = String(process.env.ENRICHMENT_RUN_ON_STARTUP || 'false').toLowerCase() === 'true';
const ENRICHMENT_STARTUP_DELAY_MS = positiveNumberEnv('ENRICHMENT_STARTUP_DELAY_MS', 30_000);

async function runEnrichment(trigger = 'scheduled') {
  const now = new Date();
  const scheduleWindow = now.toISOString().slice(0, 16);
  try {
    const result = await AdminJobService.enqueue({
      correlationId: crypto.randomUUID(),
      idempotencyKey: `${String(trigger).replace(/[^A-Za-z0-9._:-]/g, '-')}:${scheduleWindow}`,
      jobType: 'earthquake-event-enrichment',
      reason: `Automatic catalog enrichment (${trigger}).`,
      requestedBy: {
        username: 'system',
        adminRole: 'scheduler',
      },
      target: {
        type: 'earthquake_event_queue',
        id: 'pending-enrichment',
        label: 'Pending catalog enrichment',
      },
    });
    AdminJobService.wake();
    console.log(`[enrichment] ${result.reused ? 'reused' : 'queued'} ${trigger} job ${result.job._id}`);
    return result.job;
  } catch (err) {
    if (err.code === 'ADMIN_JOB_ALREADY_ACTIVE') {
      console.log(`[enrichment] skipping ${trigger} run — another enrichment job is active`);
      return err.activeJob;
    }
    console.error(`[enrichment] unable to queue ${trigger} run — ${err.message}`);
    throw err;
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
