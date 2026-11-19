// Data access for comments (community reports on earthquakes), with their helpful marks and issue
// reports. Services use this module instead of a database client. See postgres/comments.repo.js for the
// functions and the comment shape.
module.exports = require('./postgres/comments.repo').createCommentsRepo(require('../db/knex').db);
