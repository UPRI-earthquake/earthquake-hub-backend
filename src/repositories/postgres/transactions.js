// Transactions for the PostgreSQL repositories: the same interface as ../transactions.js (MongoDB).
// The `tx` passed to fn is a Knex transaction; repository functions given { tx } run their queries on it.

// `db` is a Knex instance (src/db/knex.js in the app, a test container's in integration tests)
const createPostgresTransactions = (db) => ({
  // Resolves to what fn resolves to; any error rolls back every write made through tx
  withTransaction: (fn) => db.transaction((trx) => fn(trx)),
  // PostgreSQL always supports transactions
  isTransactionUnsupported: () => false,
});

module.exports = { createPostgresTransactions };
