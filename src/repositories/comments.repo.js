// Data access for comments (community reports on earthquakes), with their helpful marks and issue
// reports. Services use this module instead of a database client, so comments can switch databases with
// COMMUNITY_DB (mongodb | postgres). Comments point to accounts and events, so they can only be on
// PostgreSQL when those are too (PEOPLE_AND_SENSORS_DB and EARTHQUAKES_DB=postgres): the backend
// refuses to start otherwise. See either implementation for the functions and the comment shape; both
// pass the same integration tests.
const { selectRepository } = require('../db/areaDatabase');

module.exports = selectRepository('comments', 'COMMUNITY_DB', {
  mongodb: () => require('./mongodb/comments.repo'),
  postgres: () => require('./postgres/comments.repo').createCommentsRepo(require('../db/knex').db),
}, { dependsOn: ['PEOPLE_AND_SENSORS_DB', 'EARTHQUAKES_DB'] });
