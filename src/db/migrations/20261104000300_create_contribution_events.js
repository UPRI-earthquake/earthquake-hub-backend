// Replaces the MongoDB `contributionevents` collection: the points ledger, one row per action that
// earns (or records) points. dedupe_key is unique, so an action never counts twice even if two
// requests race. Rows never change once written, so there's no updated_at.
//
// Deleting an account deletes its points; deleting an event keeps the points, no longer linked to it.
// There's no eventPublicID column: it's the event's public_id, and for an entry without an event (its
// event was gone when copied) metadata.eventPublicID keeps it.

exports.up = async (knex) => {
  await knex.schema.createTable('contribution_events', (table) => {
    table.comment('Points ledger: one row per action that earns (or records) points');
    table.uuid('id').primary().defaultTo(knex.raw('uuidv7()'));
    table.specificType('legacy_mongo_id', 'char(24)').unique()
      .comment('_id of the MongoDB document this row was copied from');
    table.text('dedupe_key').notNullable().unique()
      .comment('account:action:target type:target id; an action never counts twice (API: dedupeKey)');
    table.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    table.enu('action_type', [
      'report_posted', 'image_report_posted', 'report_marked_helpful', 'report_received_helpful', 'report_issue_submitted',
    ], { useNative: true, enumName: 'contribution_action' }).notNullable();
    table.enu('target_type', ['comment', 'event'], { useNative: true, enumName: 'contribution_target' })
      .notNullable().defaultTo('comment');
    table.text('target_id').comment('the comment\'s public id (comments.comment_id), or the event\'s');
    table.uuid('event_id').references('id').inTable('events').onDelete('SET NULL');
    table.integer('points').notNullable().defaultTo(0);
    table.text('reason').comment('issue reason, for report_issue_submitted');
    table.jsonb('metadata').notNullable().defaultTo(knex.raw("'{}'::jsonb"));
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['account_id', 'created_at']);
    table.index(['event_id', 'created_at']);
    table.check("btrim(dedupe_key) <> ''", [], 'contribution_events_dedupe_key_not_blank');
    table.check("jsonb_typeof(metadata) = 'object'", [], 'contribution_events_metadata_is_object');
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTable('contribution_events');
  await knex.raw('DROP TYPE contribution_target');
  await knex.raw('DROP TYPE contribution_action');
};
