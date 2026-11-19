// Transactions for comment writes and the points they earn, which must succeed or fail together (e.g. a
// helpful mark and the voter's and author's points). Same interface as transactions.js:
//
//   await withTransaction(async (tx) => {
//     const marked = await CommentsRepo.addHelpfulMark(commentId, accountId, { tx });
//     await ContributionsRepo.recordOnce(entry, { tx });
//   });
module.exports = require('./postgres/transactions').createPostgresTransactions(require('../db/knex').db);
