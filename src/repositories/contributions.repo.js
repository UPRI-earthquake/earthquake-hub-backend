// Data access for contribution points. Services use this module instead of the ContributionEvent model,
// so points can move to PostgreSQL (Step 4) without changing the services. MongoDB only for now; Step 4 -
// Ticket 3 adds the PostgreSQL version and the setting that picks between them.
//
//   recordOnce(entry) -> the stored entry
//       Stores a points entry unless one with the same dedupeKey exists (then returns that one), so a
//       repeated action never counts twice. See mongodb/contributions.repo.js for the entry shape.
module.exports = require('./mongodb/contributions.repo');
