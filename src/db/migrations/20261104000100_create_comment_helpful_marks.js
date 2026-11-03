// Replaces comments.helpfulAccountIds[]: one row per account that marked a report helpful. The primary
// key makes it one vote per person, which MongoDB only kept by how the app wrote the list. A comment's
// helpful count is its number of rows.
//
// comment_id is comments.id (the internal key), not the public comments.comment_id.

exports.up = async (knex) => {
  await knex.schema.createTable('comment_helpful_marks', (table) => {
    table.comment('An account marking a report helpful: at most once per report');
    table.uuid('comment_id').notNullable().references('id').inTable('comments').onDelete('CASCADE');
    table.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE').index();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
      .comment('copied marks: the report\'s updated_at (MongoDB kept no time per mark)');

    table.primary(['comment_id', 'account_id']);
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTable('comment_helpful_marks');
};
