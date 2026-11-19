// Data access for earthquake events. Services use this module instead of a database client. See
// postgres/events.repo.js for the functions and the event shape.
module.exports = require('./postgres/events.repo').createEventsRepo(require('../db/knex').db);
