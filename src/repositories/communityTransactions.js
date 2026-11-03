// Transactions for comment writes and the points they earn, which must succeed or fail together (e.g. a
// helpful mark and the voter's and author's points). Follows COMMUNITY_DB, like comments.repo.js and
// contributions.repo.js, so the transaction is on the database those repositories use. Same interface
// as transactions.js:
//
//   await withTransaction(async (tx) => {
//     const marked = await CommentsRepo.addHelpfulMark(commentId, accountId, { tx });
//     await ContributionsRepo.recordOnce(entry, { tx });
//   });
const { areaDatabase } = require('../db/areaDatabase');

module.exports = areaDatabase('COMMUNITY_DB') === 'postgres'
  ? require('./postgres/transactions').createPostgresTransactions(require('../db/knex').db)
  : require('./mongodb/transactions');
