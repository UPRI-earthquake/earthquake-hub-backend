const CONTRACT_VERSION = '1.0';
const DEFAULT_STALE_AFTER_MS = 60_000;
const AVAILABILITY_STATES = new Set(['available', 'degraded', 'unavailable']);

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function staleAfterMs(value) {
  return positiveInteger(
    value ?? process.env.ADMIN_TELEMETRY_STALE_AFTER_MS,
    DEFAULT_STALE_AFTER_MS,
  );
}

function validDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function freshness({ now = new Date(), observedAt, staleAfter } = {}) {
  const observed = validDate(observedAt);
  const current = validDate(now) || new Date();
  const thresholdMs = staleAfterMs(staleAfter);
  if (!observed) {
    return {
      status: 'unknown',
      observedAt: null,
      ageMs: null,
      staleAfterMs: thresholdMs,
    };
  }

  const ageMs = Math.max(0, current.getTime() - observed.getTime());
  return {
    status: ageMs > thresholdMs ? 'stale' : 'fresh',
    observedAt: observed.toISOString(),
    ageMs,
    staleAfterMs: thresholdMs,
  };
}

function buildOperationalState({
  availability = 'available',
  generatedAt = new Date(),
  message = null,
  now = generatedAt,
  observedAt,
  staleAfter,
} = {}) {
  const normalizedAvailability = AVAILABILITY_STATES.has(availability)
    ? availability
    : 'unavailable';
  const generated = validDate(generatedAt) || new Date();
  const currentFreshness = freshness({
    now,
    observedAt,
    staleAfter,
  });
  const state = normalizedAvailability === 'unavailable'
    ? 'unavailable'
    : normalizedAvailability === 'degraded'
      ? 'degraded'
      : currentFreshness.status === 'stale'
        ? 'stale'
        : currentFreshness.status === 'fresh'
          ? 'healthy'
          : 'unknown';

  return {
    contractVersion: CONTRACT_VERSION,
    generatedAt: generated.toISOString(),
    availability: normalizedAvailability,
    state,
    freshness: currentFreshness,
    message,
  };
}

module.exports = {
  CONTRACT_VERSION,
  DEFAULT_STALE_AFTER_MS,
  buildOperationalState,
  freshness,
};
