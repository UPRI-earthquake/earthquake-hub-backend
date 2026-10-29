// Data access for earthquake events. Services use this module instead of a database client, so events can
// switch databases with EARTHQUAKES_DB (mongodb | postgres). Event stations point to devices, so events
// can only be on PostgreSQL when accounts and devices are too (PEOPLE_AND_SENSORS_DB=postgres): the
// backend refuses to start otherwise. See either implementation for the functions and the event shape;
// both pass the same integration tests.
const { selectRepository } = require('../db/areaDatabase');

module.exports = selectRepository('earthquake events', 'EARTHQUAKES_DB', {
  mongodb: () => require('./mongodb/events.repo'),
  postgres: () => require('./postgres/events.repo').createEventsRepo(require('../db/knex').db),
}, { dependsOn: ['PEOPLE_AND_SENSORS_DB'] });
