// Transactions for writes to accounts and devices that must succeed or fail together (e.g. unlinking a
// device updates the device and its owner's account):
//
//   await withTransaction(async (tx) => {
//     await DevicesRepo.update(deviceId, changes, { tx });
//     await DevicesRepo.recordRelease(accountId, deviceId, snapshot, { tx });
//   });
module.exports = require('./postgres/transactions').createPostgresTransactions(require('../db/knex').db);
