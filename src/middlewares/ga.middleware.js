/**
 * Google Analytics Measurement Protocol middleware placeholder.
 *
 * Backend request telemetry is currently paused, so this middleware is a no-op.
 * When GA server-side tracking is reintroduced, implement the Measurement
 * Protocol posting logic here and wire up the required environment variables:
 * - GA_MEASUREMENT_ID
 * - GA_API_SECRET
 * - GA_ENABLED
 * - GA_SAMPLE_RATE (optional)
 */
module.exports = function gaMiddleware() {
  return (_req, _res, next) => next();
};
