// Data access for hand-curated significant earthquakes. Services use this module instead of a database
// client, so the area can switch databases with SIGNIFICANT_EQS_DB (mongodb | postgres) and no other change.
//
//   isValidId(id) -> boolean   Whether `id` looks like a record id (lets the API tell "invalid" from "not found")
//   findAll()                  Every record, in the order they were added, in the shape the API sends (`_id`, ...)
//   findById(id)               One record in that shape, or null
const { selectRepository } = require('../db/areaDatabase');

module.exports = selectRepository('significant earthquakes', 'SIGNIFICANT_EQS_DB', {
  mongodb: () => require('./mongodb/significantEqs.repo'),
  postgres: () => require('./postgres/significantEqs.repo').createSignificantEqsRepo(require('../db/knex').db),
});
