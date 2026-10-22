// Job locks in PostgreSQL (`job_locks` table): the implementation used when JOB_LOCKS_DB=postgres.
// Keep it behaving like mongodb/jobLocks.repo.js: both must pass
// __tests__/jobLocks.repo.integration.test.js.

// `db` is a Knex instance (src/db/knex.js in the app, a test container's in integration tests)
const createJobLocksRepo = (db) => {
  async function acquire(name, owner, ttlMs) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);

    // One atomic statement: insert the lock, or take over the existing row if it has expired or is
    // already ours. Otherwise the WHERE leaves the row alone and RETURNING gives no row. Concurrent
    // callers queue on the row, so only one of them can win it.
    const { rows } = await db.raw(
      `INSERT INTO job_locks (name, owner, expires_at) VALUES (?, ?, ?)
       ON CONFLICT (name) DO UPDATE SET owner = EXCLUDED.owner, expires_at = EXCLUDED.expires_at
       WHERE job_locks.expires_at <= ? OR job_locks.owner = EXCLUDED.owner
       RETURNING owner`,
      [name, owner, expiresAt, now],
    );

    return { acquired: rows.length === 1, expiresAt };
  }

  async function release(name, owner) {
    await db('job_locks').where({ name, owner }).del();
  }

  async function deleteExpired(now) {
    return db('job_locks').where('expires_at', '<=', now).del();
  }

  return {
    acquire,
    release,
    deleteExpired,
  };
};

module.exports = { createJobLocksRepo };
