// Replaces events.additionalInformation[]: the report another catalog has for the same earthquake, at
// most one per catalog. The fields the app reads have columns; upstream keys it doesn't know go in
// `extra`, and the full upstream payload (if kept) in `raw`, so nothing a catalog sent is lost.
//
// catalog_source: PHIVOLCS and USGS (matched by the nightly enrichment job), and upri-legacy (the old
// UPRI catalog's entry on imported legacy records, which the frontend shows; postgres-schema.dbml has
// only the first two). Depth is depthKm in PHIVOLCS and legacy entries and depth in USGS ones; both
// go in depth_km.

exports.up = async (knex) => {
  await knex.schema.createTable('event_catalog_matches', (table) => {
    table.comment('The matching report another catalog (PHIVOLCS, USGS, old UPRI) has for an earthquake');
    table.uuid('id').primary().defaultTo(knex.raw('uuidv7()'));
    table.uuid('event_id').notNullable().references('id').inTable('events').onDelete('CASCADE');
    table.enu('source', ['phivolcs', 'usgs', 'upri-legacy'], { useNative: true, enumName: 'catalog_source' }).notNullable();
    table.text('source_label').comment('API: sourceLabel');
    table.text('source_icon_url').comment('API: sourceIconUrl');
    table.text('external_id').comment('id in that catalog (API: id)');
    table.text('title');
    table.text('place');
    table.text('location_text').comment('API: location');
    table.text('detail');
    table.text('url');
    table.text('detail_url').comment('API: detailUrl');
    table.text('query_url').comment('API: queryUrl');
    table.timestamp('match_time', { useTz: true }).comment('API: time');
    table.text('match_time_text').comment('PHIVOLCS date text, GMT+8 (API: dateTime)');
    table.double('latitude');
    table.double('longitude');
    table.double('depth_km').comment('API: depthKm (PHIVOLCS, legacy) or depth (USGS)');
    table.double('magnitude');
    table.boolean('has_felt_intensity').comment('API: hasFeltIntensity');
    table.double('distance_km').comment('API: distanceKm');
    table.double('time_difference_minutes').comment('API: timeDifferenceMinutes');
    table.double('magnitude_difference').comment('API: magnitudeDifference');
    table.boolean('latitude_floor_match').comment('API: latitudeFloorMatch');
    table.boolean('longitude_floor_match').comment('API: longitudeFloorMatch');
    table.double('score').comment('lower is a better match');
    table.enu('match_quality', ['high', 'medium', 'low'], { useNative: true, enumName: 'match_quality' }).comment('API: matchQuality');
    table.jsonb('extra').notNullable().defaultTo(knex.raw("'{}'::jsonb")).comment('upstream keys without a column');
    table.jsonb('raw').comment('full upstream payload');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(['event_id', 'source']);
    table.check("jsonb_typeof(extra) = 'object'", [], 'event_catalog_matches_extra_is_object');
  });

  await knex.raw(`
    CREATE TRIGGER event_catalog_matches_set_updated_at BEFORE UPDATE ON event_catalog_matches
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `);
};

exports.down = async (knex) => {
  await knex.schema.dropTable('event_catalog_matches');
  await knex.raw('DROP TYPE catalog_source');
  await knex.raw('DROP TYPE match_quality');
};
