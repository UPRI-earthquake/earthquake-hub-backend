// Details admins add to an earthquake for the significant earthquakes page: the stations whose
// recordings to show, and links to reports. One row per event, deleted with the event. Which events are
// significant isn't stored: the significance score picks them on each request (src/services/significance.js).
// The page's summary is the event's own summary_override_text, so it has no column here.
//
// Rows copied from the old MongoDB `significant-eqs` collection (scripts/copy-significant-eq-details-to-postgres.js)
// keep that entry's _id in legacy_mongo_id.

exports.up = async (knex) => {
  await knex.schema.createTable('significant_eq_details', (table) => {
    table.comment('Hand-added details for an earthquake on the significant earthquakes page');
    table.uuid('id').primary().defaultTo(knex.raw('uuidv7()'));
    table.specificType('legacy_mongo_id', 'char(24)').unique()
      .comment('_id of the MongoDB significant-eqs entry this row was copied from');
    table.uuid('event_id').notNullable().unique().references('id').inTable('events').onDelete('CASCADE');
    table.specificType('instrument_recordings', 'text[]').notNullable().defaultTo(knex.raw("'{}'"))
      .comment('station codes whose recordings the page shows (API: instrumentRecordings)');
    table.specificType('reference_urls', 'text[]').notNullable().defaultTo(knex.raw("'{}'"))
      .comment('links to reports about the earthquake (API: references)');
    table.text('edited_by').comment('admin who last set them');
    table.timestamp('edited_at', { useTz: true });
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(`
    CREATE TRIGGER significant_eq_details_set_updated_at BEFORE UPDATE ON significant_eq_details
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `);
};

exports.down = async (knex) => {
  await knex.schema.dropTable('significant_eq_details');
};
