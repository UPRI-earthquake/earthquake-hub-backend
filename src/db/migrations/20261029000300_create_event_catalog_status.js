// Replaces the enrichment bookkeeping MongoDB kept on each event (pendingCatalogSources,
// catalogEnrichmentStatus/Attempts and the legacy upForEnrichment/enrichmentAttempts): one row per
// earthquake per catalog the nightly job searches. An event is due for a catalog while its row is
// pending with attempts left; (source, status) indexes that lookup.

exports.up = async (knex) => {
  await knex.schema.createTable('event_catalog_status', (table) => {
    table.comment('How far the nightly enrichment job got for one earthquake in one catalog');
    table.uuid('event_id').notNullable().references('id').inTable('events').onDelete('CASCADE');
    table.specificType('source', 'catalog_source').notNullable();
    table.enu('status', ['pending', 'done', 'no_match', 'failed'], { useNative: true, enumName: 'enrichment_status' })
      .notNullable().defaultTo('pending');
    table.integer('attempts').notNullable().defaultTo(0);
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.primary(['event_id', 'source']);
    table.index(['source', 'status']);
    table.check('attempts >= 0', [], 'event_catalog_status_attempts_not_negative');
    // Only the catalogs the job searches; legacy UPRI entries are imported, never looked up
    table.check("source IN ('phivolcs', 'usgs')", [], 'event_catalog_status_searched_source');
  });

  await knex.raw(`
    CREATE TRIGGER event_catalog_status_set_updated_at BEFORE UPDATE ON event_catalog_status
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `);
};

exports.down = async (knex) => {
  await knex.schema.dropTable('event_catalog_status');
  await knex.raw('DROP TYPE enrichment_status');
};
