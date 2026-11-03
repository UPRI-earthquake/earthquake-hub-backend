// Replaces the MongoDB `comments` collection: community reports on an earthquake. What MongoDB embedded
// in each comment gets its own table: helpful marks in comment_helpful_marks, issue reports in
// comment_issue_reports. Copy existing data with scripts/copy-community-to-postgres.js.
//
// A comment must belong to a real event (deleting the event deletes its comments). Its account is
// optional (null = posted signed out); deleting the account keeps the comment, no longer linked to
// anyone, under the username it was posted with. There's no eventPublicID column: it's the event's
// public_id.
//
// comment_id is the public id (API: commentId), a UUID as MongoDB generated them; `id` is the key the
// other tables use.

exports.up = async (knex) => {
  await knex.schema.createTable('comments', (table) => {
    table.comment('A community report on an earthquake: text and/or an image');
    table.uuid('id').primary().defaultTo(knex.raw('uuidv7()'));
    table.specificType('legacy_mongo_id', 'char(24)').unique()
      .comment('_id of the MongoDB document this row was copied from');
    table.uuid('comment_id').notNullable().unique().defaultTo(knex.raw('gen_random_uuid()'))
      .comment('public id used in URLs (API: commentId)');
    table.uuid('event_id').notNullable().references('id').inTable('events').onDelete('CASCADE');
    table.uuid('account_id').references('id').inTable('accounts').onDelete('SET NULL').index()
      .comment('who posted it; null = signed out, or the account was deleted');
    table.text('username').notNullable().defaultTo('Anonymous').comment('name shown: the username, or Anonymous');
    table.string('content', 1000).comment('the report text');
    table.text('image_url').comment('path of the uploaded image (API: imageURL)');
    table.enu('status', ['pending', 'approved', 'rejected'], { useNative: true, enumName: 'comment_status' })
      .notNullable().defaultTo('approved').comment('moderation: only approved reports are shown');
    table.text('moderated_by').comment('admin who set the status');
    table.timestamp('moderated_at', { useTz: true });
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // An event's visible reports, newest first (comment_id breaks ties, as the API's paging does)
    table.index(['event_id', 'status', 'created_at', 'comment_id']);
    table.check(
      "(content IS NOT NULL AND btrim(content) <> '') OR (image_url IS NOT NULL AND btrim(image_url) <> '')",
      [],
      'comments_has_content_or_image',
    );
    table.check("btrim(username) <> ''", [], 'comments_username_not_blank');
  });

  await knex.raw(`
    CREATE TRIGGER comments_set_updated_at BEFORE UPDATE ON comments
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `);
};

exports.down = async (knex) => {
  await knex.schema.dropTable('comments');
  await knex.raw('DROP TYPE comment_status');
};
