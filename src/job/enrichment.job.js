const cron = require('node-cron');
const { addAdditionalInformation } = require('../services/events.service');

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

let isRunning = false;

async function runEnrichment() {
  if (isRunning) {
    console.log('[enrichment] skipping scheduled run — previous run is still in progress');
    return;
  }

  isRunning = true;
  console.log(`[enrichment] starting scheduled run at ${new Date().toISOString()}`);

  try {
    const result = await addAdditionalInformation();
    console.log(
      `[enrichment] completed at ${new Date().toISOString()} — ` +
      `modified=${result.modifiedCount} skipped=${result.skippedCount} ` +
      `exhausted=${result.exhaustedCount} total=${result.totalProcessed}`
    );
  } catch (err) {
    console.error(`[enrichment] job failed at ${new Date().toISOString()} — ${err.message}`);
    console.error(err.stack);
  } finally {
    isRunning = false;
  }
}

function startEnrichmentScheduler() {
  if (!cron.validate(ENRICHMENT_CRON)) {
    console.error(`[enrichment] invalid cron expression "${ENRICHMENT_CRON}" — scheduler not started`);
    return;
  }

  cron.schedule(ENRICHMENT_CRON, runEnrichment, {
    timezone: process.env.TZ || 'Asia/Manila',
  });

  console.log(`[enrichment] scheduler registered — cron="${ENRICHMENT_CRON}" tz=${process.env.TZ || 'Asia/Manila'}`);
}

module.exports = { startEnrichmentScheduler };