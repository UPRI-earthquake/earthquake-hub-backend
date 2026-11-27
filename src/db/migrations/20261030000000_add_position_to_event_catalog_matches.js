// An event's catalog matches come back in the order MongoDB's additionalInformation[] had them: the
// frontend shows the catalogs in that order. Existing rows get 0 (catalog order); re-run the copy
// (npm run db:pg:copy-earthquakes) to fill in MongoDB's order.

exports.up = async (knex) => {
  await knex.schema.alterTable('event_catalog_matches', (table) => {
    table.smallint('position').notNullable().defaultTo(0).comment('order among the event\'s matches (API: additionalInformation[] order)');
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('event_catalog_matches', (table) => {
    table.dropColumn('position');
  });
};
