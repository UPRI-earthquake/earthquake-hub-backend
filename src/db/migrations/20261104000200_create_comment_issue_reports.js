// Replaces comments.issueReports[]: private moderation flags on a report, one per account (a second
// flag by the same account replaces the first). Never shown publicly.
//
// comment_id is comments.id (the internal key), not the public comments.comment_id.

exports.up = async (knex) => {
  await knex.schema.createTable('comment_issue_reports', (table) => {
    table.comment('An account flagging a report for moderators: at most one flag per account per report');
    table.uuid('comment_id').notNullable().references('id').inTable('comments').onDelete('CASCADE');
    table.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE').index();
    table.enu('reason', ['duplicate', 'unclear', 'wrong_location', 'not_related', 'inappropriate'], { useNative: true, enumName: 'issue_reason' })
      .notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
      .comment('when the account last flagged it');

    table.primary(['comment_id', 'account_id']);
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTable('comment_issue_reports');
  await knex.raw('DROP TYPE issue_reason');
};
