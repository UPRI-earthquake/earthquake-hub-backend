// Data access for background-job locks. Services use this module instead of a database client, so the
// area can switch databases with JOB_LOCKS_DB (mongodb | postgres) and no other change.
//
//   acquire(name, owner, ttlMs) -> { acquired: boolean, expiresAt: Date }
//       Takes the lock if it's free, expired, or already held by `owner` (which renews it).
//   release(name, owner)        Releases the lock only if `owner` still holds it.
//   deleteExpired(now) -> count Deletes locks that expired at or before `now`.
const { selectRepository } = require('../db/areaDatabase');

module.exports = selectRepository('job locks', 'JOB_LOCKS_DB', {
  mongodb: () => require('./mongodb/jobLocks.repo'),
  postgres: () => require('./postgres/jobLocks.repo').createJobLocksRepo(require('../db/knex').db),
});
