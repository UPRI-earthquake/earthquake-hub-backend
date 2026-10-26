// Transactions for the MongoDB accounts and devices repositories (PEOPLE_AND_SENSORS_DB=mongodb), for
// writes that must succeed or fail together (e.g. unlinking a device updates the device and its
// owner's account).
//
//   await withTransaction(async (tx) => {
//     await DevicesRepo.update(deviceId, changes, { tx });
//     await DevicesRepo.recordRelease(accountId, deviceId, snapshot, { tx });
//   });
const mongoose = require('mongoose');

// Runs fn(tx) in a transaction and resolves to what fn resolves to. Repository functions join the
// transaction when given { tx }. A MongoDB without a replica set can't run transactions: that throws
// an error isTransactionUnsupported() recognises, so callers can fall back to plain writes.
async function withTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

const isTransactionUnsupported = (err) => {
  const message = String(err?.message || '').toLowerCase();
  return message.includes('replica set') || message.includes('transactions are not supported');
};

module.exports = {
  withTransaction,
  isTransactionUnsupported,
};
