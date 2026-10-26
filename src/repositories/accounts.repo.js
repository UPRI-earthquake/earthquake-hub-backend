// Data access for accounts. Services use this module instead of a database client, so accounts can
// switch databases with PEOPLE_AND_SENSORS_DB (mongodb | postgres) and no other change. Accounts and
// devices share that one setting (with transactions.js): they reference each other, so they move together.
//
//   findByUsername(username, { role }), findByEmail(email), findByUsernameAndEmail(username, email),
//   findByRingserverUrl(url), findById(id, { tx }), create(fields), update(id, changes, { tx }),
//   remove(id), listApprovedRingserverHosts(), recordRingserverConnection(username, at)
//
// See either implementation for the account shape; both pass the same integration tests.
const { selectRepository } = require('../db/areaDatabase');

module.exports = selectRepository('accounts', 'PEOPLE_AND_SENSORS_DB', {
  mongodb: () => require('./mongodb/accounts.repo'),
  postgres: () => require('./postgres/accounts.repo').createAccountsRepo(require('../db/knex').db),
});
