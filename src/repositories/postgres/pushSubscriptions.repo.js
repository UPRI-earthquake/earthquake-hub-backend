// Push subscriptions in PostgreSQL (`push_subscriptions` table): the implementation used when
// PUSH_SUBSCRIPTIONS_DB=postgres. Keep it behaving like mongodb/pushSubscriptions.repo.js: both must
// pass __tests__/pushSubscriptions.repo.integration.test.js.
//
// Write functions take `now` from the caller, so one operation uses a single timestamp throughout.

// pg returns bigint columns as strings; expiration_time is epoch ms, well within Number's safe range
const toNumberOrNull = (value) => (value === null || value === undefined ? null : Number(value));

const toSubscriber = (row) => ({
  id: row.id,
  endpoint: row.endpoint,
  expirationTime: toNumberOrNull(row.expiration_time),
  keys: { p256dh: row.key_p256dh, auth: row.key_auth },
});

// `db` is a Knex instance (src/db/knex.js in the app, a test container's in integration tests)
const createPushSubscriptionsRepo = (db) => {
  // Resolves to whether the database answers right now (callers skip their work instead of failing)
  async function isAvailable() {
    try {
      await db.raw('SELECT 1');
      return true;
    } catch (_) {
      return false;
    }
  }

  // Creates the subscription, or refreshes the row with the same endpoint: active again, new keys
  // and client details, failure history cleared. Resolves to { created }.
  async function upsert(subscription, now) {
    const { clientMeta = {} } = subscription;
    const expirationTime = toNumberOrNull(subscription.expirationTime);

    const { rows: [row] } = await db.raw(
      `INSERT INTO push_subscriptions AS s (
         endpoint, expiration_time, key_p256dh, key_auth, status, last_seen_at, consecutive_failures,
         client_user_agent, client_app_version, client_time, source_sw_script
       ) VALUES (?, ?, ?, ?, 'active', ?, 0, ?, ?, ?, ?)
       ON CONFLICT (endpoint) DO UPDATE SET
         expiration_time = EXCLUDED.expiration_time,
         key_p256dh = EXCLUDED.key_p256dh,
         key_auth = EXCLUDED.key_auth,
         status = 'active',
         last_seen_at = EXCLUDED.last_seen_at,
         consecutive_failures = 0,
         client_user_agent = EXCLUDED.client_user_agent,
         client_app_version = EXCLUDED.client_app_version,
         client_time = EXCLUDED.client_time,
         source_sw_script = COALESCE(EXCLUDED.source_sw_script, s.source_sw_script),
         invalidated_at = NULL,
         cleanup_after = NULL,
         last_failure_at = NULL,
         last_failure_code = NULL
       RETURNING (xmax = 0) AS created`, // xmax is 0 only on a freshly inserted row
      [
        subscription.endpoint,
        // MongoDB kept any number; bigint needs a whole one
        expirationTime === null ? null : Math.round(expirationTime),
        subscription.keys.p256dh,
        subscription.keys.auth,
        now,
        clientMeta.userAgent ?? null,
        clientMeta.appVersion ?? null,
        clientMeta.clientTime ?? null,
        subscription.sourceSwScript || null,
      ],
    );

    return { created: row.created };
  }

  async function listActive() {
    const rows = await db('push_subscriptions')
      .select('id', 'endpoint', 'expiration_time', 'key_p256dh', 'key_auth')
      .whereNot('status', 'invalid');
    return rows.map(toSubscriber);
  }

  async function recordDelivery(id, now) {
    await db('push_subscriptions').where({ id }).update({
      status: 'active',
      last_delivered_at: now,
      consecutive_failures: 0,
      last_failure_at: null,
      last_failure_code: null,
      invalidated_at: null,
      cleanup_after: null,
    });
  }

  async function recordFailure(id, code, now) {
    await db('push_subscriptions').where({ id }).update({
      last_failure_at: now,
      last_failure_code: code,
      consecutive_failures: db.raw('consecutive_failures + 1'),
    });
  }

  async function markInvalid(id, { code, cleanupAfter, now }) {
    await db('push_subscriptions').where({ id }).update({
      status: 'invalid',
      invalidated_at: now,
      cleanup_after: cleanupAfter,
      last_failure_at: now,
      last_failure_code: code,
      consecutive_failures: db.raw('consecutive_failures + 1'),
    });
  }

  async function markExpiredInvalid({ cleanupAfter, now }) {
    return db('push_subscriptions')
      .whereNot('status', 'invalid')
      .where('expiration_time', '<=', now.getTime())
      .update({
        status: 'invalid',
        invalidated_at: now,
        cleanup_after: cleanupAfter,
        last_failure_at: now,
        last_failure_code: 410,
      });
  }

  async function markStaleInvalid({ staleCutoff, failureThreshold, cleanupAfter, now }) {
    return db('push_subscriptions')
      .where('status', 'active')
      .where('last_seen_at', '<=', staleCutoff)
      .where('consecutive_failures', '>=', failureThreshold)
      .update({
        status: 'invalid',
        invalidated_at: now,
        cleanup_after: cleanupAfter,
      });
  }

  // Replaces MongoDB's TTL index on cleanupAfter; run by the cleanup scheduler
  async function deleteExpired(now) {
    return db('push_subscriptions')
      .where('status', 'invalid')
      .where('cleanup_after', '<=', now)
      .del();
  }

  return {
    isAvailable,
    upsert,
    listActive,
    recordDelivery,
    recordFailure,
    markInvalid,
    markExpiredInvalid,
    markStaleInvalid,
    deleteExpired,
  };
};

module.exports = { createPushSubscriptionsRepo };
