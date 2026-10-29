// Data access for earthquake events. Services use this module instead of the Event model, so events can
// move to PostgreSQL (Step 3) without changing the services. MongoDB only for now; Step 3 - Ticket 3
// adds the PostgreSQL version and the setting that picks between them. See mongodb/events.repo.js for
// the functions and the shape they return.
module.exports = require('./mongodb/events.repo');
