// Data access for devices, each account's device list, and released-device history. Services use this
// module instead of a database client, so devices can switch databases with PEOPLE_AND_SENSORS_DB
// (mongodb | postgres), together with accounts. See either implementation for the functions and shapes;
// both pass the same integration tests.
const { selectRepository } = require('../db/areaDatabase');

module.exports = selectRepository('devices', 'PEOPLE_AND_SENSORS_DB', {
  mongodb: () => require('./mongodb/devices.repo'),
  postgres: () => require('./postgres/devices.repo').createDevicesRepo(require('../db/knex').db),
});
