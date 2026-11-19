// Data access for accounts. Services use this module instead of a database client.
//
//   findByUsername(username, { role }), findByEmail(email), findByUsernameAndEmail(username, email),
//   findByRingserverUrl(url), findById(id, { tx }), create(fields), update(id, changes, { tx }),
//   remove(id), listApprovedRingserverHosts(), recordRingserverConnection(username, at)
//
// See postgres/accounts.repo.js for the account shape.
module.exports = require('./postgres/accounts.repo').createAccountsRepo(require('../db/knex').db);
