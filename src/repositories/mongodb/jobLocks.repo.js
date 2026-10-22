// Job locks in MongoDB (`joblocks` collection): the implementation used when JOB_LOCKS_DB=mongodb.
// Keep it behaving like postgres/jobLocks.repo.js: both must pass
// __tests__/jobLocks.repo.integration.test.js.
const JobLock = require('../../models/jobLock.model');

/***************************************************************************
  * acquire:
  *     Takes the lock `name` for `owner` if it's free, expired, or already held by `owner`
  *     (which renews it).
  *
  * Outputs:
  *     { acquired: boolean, expiresAt: Date }
 ***************************************************************************/
async function acquire(name, owner, ttlMs) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);

  let lock = null;
  try {
    lock = await JobLock.findOneAndUpdate(
      {
        name,
        $or: [
          { expiresAt: { $lte: now } },
          { owner },
        ],
      },
      { $set: { name, owner, expiresAt } },
      { upsert: true, new: true },
    );
  } catch (err) {
    // Duplicate key: another owner holds an unexpired lock, so the upsert tried to insert a second one
    if (err.code !== 11000) throw err;
  }

  return {
    acquired: Boolean(lock && lock.owner === owner),
    expiresAt,
  };
}

// Releases the lock only if `owner` still holds it
async function release(name, owner) {
  await JobLock.deleteOne({ name, owner });
}

// Deletes locks that expired at or before `now`. Resolves to the count. (The TTL index does this too;
// the explicit delete keeps both implementations alike for the cleanup scheduler.)
async function deleteExpired(now) {
  const result = await JobLock.deleteMany({ expiresAt: { $lte: now } });
  return result.deletedCount || 0;
}

module.exports = {
  acquire,
  release,
  deleteExpired,
};
