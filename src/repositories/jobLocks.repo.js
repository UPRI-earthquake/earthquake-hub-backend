// Data access for background-job locks. Services use these functions instead of the Mongoose model,
// so the storage (MongoDB today, PostgreSQL later) can change without touching them.
const JobLock = require('../models/jobLock.model');

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

module.exports = {
  acquire,
  release,
};
