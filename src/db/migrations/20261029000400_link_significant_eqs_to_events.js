// significant_eqs.event_id (added in Step 1, unenforced until events existed in PostgreSQL) now points
// to events. Deleting the event keeps the curated record and clears the link.

exports.up = async (knex) => {
  await knex.schema.alterTable('significant_eqs', (table) => {
    table.foreign('event_id').references('id').inTable('events').onDelete('SET NULL');
    table.index('event_id');
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('significant_eqs', (table) => {
    table.dropIndex('event_id');
    table.dropForeign('event_id');
  });
};
