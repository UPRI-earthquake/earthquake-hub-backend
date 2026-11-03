// Data access for comments (community reports on earthquakes), with their helpful marks and issue
// reports. Services use this module instead of the Comment model, so comments can move to PostgreSQL
// (Step 4) without changing the services. MongoDB only for now; Step 4 - Ticket 3 adds the PostgreSQL
// version and the setting that picks between them. See mongodb/comments.repo.js for the functions and
// the comment shape.
module.exports = require('./mongodb/comments.repo');
