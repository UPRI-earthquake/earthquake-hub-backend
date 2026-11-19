// Data access for devices, each account's device list, and released-device history. Services use this
// module instead of a database client. See postgres/devices.repo.js for the functions and shapes.
module.exports = require('./postgres/devices.repo').createDevicesRepo(require('../db/knex').db);
