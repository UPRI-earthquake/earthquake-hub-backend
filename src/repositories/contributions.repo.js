// Data access for contribution points. Services use this module instead of a database client.
//
//   recordOnce(entry, { tx }) -> the stored entry
//       Stores a points entry unless one with the same dedupeKey exists (then returns that one), so a
//       repeated action never counts twice. See postgres/contributions.repo.js for the entry shape.
module.exports = require('./postgres/contributions.repo').createContributionsRepo(require('../db/knex').db);
