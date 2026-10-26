// Transactions for writes to accounts and devices that must succeed or fail together (e.g. unlinking a
// device updates the device and its owner's account). Follows PEOPLE_AND_SENSORS_DB, like
// accounts.repo.js and devices.repo.js, so the transaction is on the database those repositories use.
//
//   await withTransaction(async (tx) => {
//     await DevicesRepo.update(deviceId, changes, { tx });
//     await DevicesRepo.recordRelease(accountId, deviceId, snapshot, { tx });
//   });
//
// isTransactionUnsupported(err) recognises a MongoDB without a replica set (callers fall back to plain
// writes); PostgreSQL always supports transactions.
const { areaDatabase } = require('../db/areaDatabase');

module.exports = areaDatabase('PEOPLE_AND_SENSORS_DB') === 'postgres'
  ? require('./postgres/transactions').createPostgresTransactions(require('../db/knex').db)
  : require('./mongodb/transactions');
