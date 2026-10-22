// Replaces the MongoDB `significant-eqs` collection. Copy existing data with
// scripts/copy-significant-eqs-to-postgres.js.
//
// MongoDB accepted any document here; this table enforces the rules the data always meant to follow,
// so a bad record is rejected on write instead of breaking the page that shows it.

exports.up = async (knex) => {
  await knex.schema.createTable('significant_eqs', (table) => {
    table.comment('Hand-curated notable earthquakes shown on the significant earthquakes page');
    table.uuid('id').primary().defaultTo(knex.raw('uuidv7()'));
    table.specificType('legacy_mongo_id', 'char(24)').unique()
      .comment('_id of the MongoDB document this row was copied from; the API keeps returning it as _id');
    // The foreign key to events is added once events move to PostgreSQL (Step 3)
    table.uuid('event_id').comment('optional: the detected event this earthquake corresponds to');
    table.text('title').notNullable();
    table.double('magnitude').notNullable();
    table.double('depth_km').comment('API: depth');
    table.double('latitude').notNullable();
    table.double('longitude').notNullable();
    table.text('location_text').comment('place name (API: location)');
    table.timestamp('event_time', { useTz: true }).notNullable().index().comment('API: eventTime');
    table.text('event_summary').comment('HTML (API: eventSummary)');
    table.jsonb('instrument_recordings').notNullable().defaultTo(knex.raw("'[]'::jsonb"))
      .comment('station codes (API: instrumentRecordings)');
    table.jsonb('reference_links').notNullable().defaultTo(knex.raw("'[]'::jsonb"))
      .comment('URLs (API: references; REFERENCES is a reserved word in SQL)');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.check("btrim(title) <> ''", [], 'significant_eqs_title_not_blank');
    table.check('magnitude BETWEEN -2 AND 10', [], 'significant_eqs_magnitude_range');
    table.check('depth_km BETWEEN -10 AND 1000', [], 'significant_eqs_depth_range');
    table.check('latitude BETWEEN -90 AND 90', [], 'significant_eqs_latitude_range');
    table.check('longitude BETWEEN -180 AND 180', [], 'significant_eqs_longitude_range');
    table.check("jsonb_typeof(instrument_recordings) = 'array'", [], 'significant_eqs_recordings_is_array');
    table.check("jsonb_typeof(reference_links) = 'array'", [], 'significant_eqs_references_is_array');
  });

  // Computed by PostgreSQL from latitude/longitude, so it can never disagree with them
  await knex.raw(`
    ALTER TABLE significant_eqs ADD COLUMN location geography(Point, 4326)
      GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography) STORED
  `);
  await knex.raw('CREATE INDEX significant_eqs_location_idx ON significant_eqs USING GIST (location)');
  await knex.raw(`
    CREATE TRIGGER significant_eqs_set_updated_at BEFORE UPDATE ON significant_eqs
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `);
};

exports.down = async (knex) => {
  await knex.schema.dropTable('significant_eqs');
};
