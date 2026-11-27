// Replaces the MongoDB `events` collection: one earthquake detected by SeisComP. What MongoDB embedded
// in each event gets its own table: station lists in event_stations, PHIVOLCS/USGS matches in
// event_catalog_matches, enrichment progress in event_catalog_status. Copy existing data with
// scripts/copy-earthquakes-to-postgres.js.
//
// The API keeps its field names (OT, latitude_value, ...); the column comments give them. Coordinates
// aren't range-checked, since old records may hold bad ones: `location` is simply null for those, as
// MongoDB left the GeoJSON point unset.

exports.up = async (knex) => {
  await knex.schema.createTable('events', (table) => {
    table.comment('One earthquake detected by SeisComP');
    table.uuid('id').primary().defaultTo(knex.raw('uuidv7()'));
    table.specificType('legacy_mongo_id', 'char(24)').unique()
      .comment('_id of the MongoDB document this row was copied from');
    table.text('public_id').notNullable().unique().comment('SeisComP event id (API: publicID)');
    table.text('source_catalog').notNullable().defaultTo('upri-current').index().comment('API: sourceCatalog');
    table.text('source_server').comment('API: sourceServer');
    table.text('source_seiscomp_version').comment('API: sourceSeiscompVersion');
    table.boolean('is_legacy_record').notNullable().defaultTo(false).index().comment('imported from the old catalog (API: isLegacyRecord)');
    table.timestamp('legacy_imported_at', { useTz: true }).comment('API: legacyImportedAt');
    table.text('legacy_source_public_id').comment('API: legacySourcePublicID');
    table.timestamp('origin_time', { useTz: true }).index().comment('API: OT');
    table.double('latitude').comment('API: latitude_value');
    table.double('longitude').comment('API: longitude_value');
    table.double('depth_km').comment('API: depth_value');
    table.double('magnitude').comment('API: magnitude_value');
    table.string('seiscomp_type', 10).comment('latest SeisComP message type, e.g. NEW, UPDATE (API: type)');
    table.text('region_text').comment('SeisComP region text (API: text)');
    table.text('place').comment('GeoServe place name, filled on first read');
    table.enu('recording_status', ['pending', 'partial', 'verified', 'unavailable'], { useNative: true, enumName: 'recording_status' })
      .notNullable().defaultTo('pending').index().comment('which nearby stations recorded it (API: recordingAvailabilityStatus)');
    table.timestamp('recording_checked_at', { useTz: true }).comment('API: recordingAvailabilityCheckedAt');
    table.integer('recording_attempts').notNullable().defaultTo(0).comment('API: recordingAvailabilityAttempts');
    table.timestamp('last_modification', { useTz: true }).comment('drops SeisComP updates that arrive out of order');
    table.text('summary_override_text').comment('summary edited by hand (API: summaryOverride.text)');
    table.timestamp('summary_override_edited_at', { useTz: true });
    table.text('summary_override_edited_by');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.check("btrim(public_id) <> ''", [], 'events_public_id_not_blank');
    table.check('recording_attempts >= 0', [], 'events_recording_attempts_not_negative');
    table.check(
      'summary_override_text IS NOT NULL OR (summary_override_edited_at IS NULL AND summary_override_edited_by IS NULL)',
      [],
      'events_summary_override_has_text',
    );
  });

  // Computed by PostgreSQL from latitude/longitude, so it can never disagree with them; null when
  // they're missing or out of range
  await knex.raw(`
    ALTER TABLE events ADD COLUMN location geography(Point, 4326) GENERATED ALWAYS AS (
      CASE WHEN latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180
        THEN ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
      END
    ) STORED
  `);
  await knex.raw('CREATE INDEX events_location_idx ON events USING GIST (location)');
  await knex.raw(`
    CREATE TRIGGER events_set_updated_at BEFORE UPDATE ON events
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `);
};

exports.down = async (knex) => {
  await knex.schema.dropTable('events');
  await knex.raw('DROP TYPE recording_status');
};
