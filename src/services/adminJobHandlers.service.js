const EQEventsService = require('./EQevents.service');
const { acquireJobLock } = require('./jobLock.service');

const ENRICHMENT_JOB_LOCK_NAME = 'additional-information-enrichment';

function positiveNumberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function runEarthquakeEventEnrichment({ signal, updateProgress }) {
  const lock = await acquireJobLock(
    ENRICHMENT_JOB_LOCK_NAME,
    positiveNumberEnv('ENRICHMENT_LOCK_TTL_MS', 60 * 60 * 1000),
  );
  if (!lock.acquired) {
    throw Object.assign(
      new Error('Catalog enrichment is already running in another worker.'),
      { code: 'ENRICHMENT_ALREADY_RUNNING', retryable: true },
    );
  }

  try {
    return await EQEventsService.addAdditionalInformation({
      signal,
      onProgress: updateProgress,
    });
  } finally {
    try {
      await lock.release();
    } catch (error) {
      console.error('Unable to release catalog enrichment lock:', error?.message || error);
    }
  }
}

async function runRecordingAvailabilityRefresh({ signal, updateProgress }) {
  const batchSize = positiveNumberEnv('RECORDING_AVAILABILITY_JOB_BATCH_SIZE', 100);
  return EQEventsService.updateOnlineStations({
    batchSize: Math.min(Math.floor(batchSize), 500),
    onlyAttention: true,
    signal,
    onProgress: updateProgress,
  });
}

const HANDLERS = Object.freeze({
  'earthquake-event-enrichment': runEarthquakeEventEnrichment,
  'earthquake-recording-availability-refresh': runRecordingAvailabilityRefresh,
});

function getHandler(jobType) {
  return HANDLERS[jobType] || null;
}

module.exports = {
  getHandler,
  runEarthquakeEventEnrichment,
  runRecordingAvailabilityRefresh,
};
