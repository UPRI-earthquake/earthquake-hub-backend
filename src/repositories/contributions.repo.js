// Data access for contribution points. Services use this module instead of a database client, so points
// switch databases with comments (COMMUNITY_DB, mongodb | postgres; on PostgreSQL only with accounts and
// events there too).
//
//   recordOnce(entry, { tx }) -> the stored entry
//       Stores a points entry unless one with the same dedupeKey exists (then returns that one), so a
//       repeated action never counts twice. See mongodb/contributions.repo.js for the entry shape.
const { selectRepository } = require('../db/areaDatabase');

module.exports = selectRepository('contribution points', 'COMMUNITY_DB', {
  mongodb: () => require('./mongodb/contributions.repo'),
  postgres: () => require('./postgres/contributions.repo').createContributionsRepo(require('../db/knex').db),
}, { dependsOn: ['PEOPLE_AND_SENSORS_DB', 'EARTHQUAKES_DB'] });
