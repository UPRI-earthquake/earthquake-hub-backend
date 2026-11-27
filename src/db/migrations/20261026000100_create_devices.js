// Replaces the MongoDB `devices` collection. Ownership moves here from accounts.devices[]: each
// device has at most one owner (owner_account_id), and deleting the owner unlinks the device.
//
// Identity rules the database now enforces: one device per network + station, and a stream ID or MAC
// address belongs to one device only. A device not linked yet has NULL stream_id / mac_address (any
// number of NULLs are allowed; empty strings aren't, so "not linked" has one meaning).

exports.up = async (knex) => {
  await knex.schema.createTable('devices', (table) => {
    table.comment('One Raspberry Shake sensor');
    table.uuid('id').primary().defaultTo(knex.raw('uuidv7()'));
    table.specificType('legacy_mongo_id', 'char(24)').unique()
      .comment('_id of the MongoDB document this row was copied from');
    table.uuid('owner_account_id').references('id').inTable('accounts').onDelete('SET NULL').index()
      .comment('null = no owner (unlinked); replaces accounts.devices[]');
    table.string('network', 8).notNullable().comment('e.g. AM');
    table.string('station', 16).notNullable().comment('e.g. R3B2D');
    table.text('description');
    table.text('stream_id').unique().comment('null = not linked yet');
    table.text('mac_address').unique().comment('null = not linked yet');
    table.double('latitude').notNullable();
    table.double('longitude').notNullable();
    table.double('elevation_m').notNullable().comment('API: elevation');
    table.enu('activity', ['active', 'inactive', 'unlinked'], { useNative: true, enumName: 'device_activity' })
      .notNullable().defaultTo('inactive').index();
    table.timestamp('activity_toggled_at', { useTz: true }).notNullable()
      .defaultTo(knex.raw("'1970-01-01T00:00:00Z'")).comment('API: activityToggleTime');
    table.text('rshake_alert_credential_hash').comment('never returned by the API');
    table.timestamp('rshake_alert_credential_issued_at', { useTz: true });
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(['network', 'station']);
    table.check("btrim(network) <> '' AND btrim(station) <> ''", [], 'devices_network_station_not_blank');
    table.check("stream_id <> ''", [], 'devices_stream_id_not_empty');
    table.check("mac_address <> ''", [], 'devices_mac_address_not_empty');
    table.check('latitude BETWEEN -90 AND 90', [], 'devices_latitude_range');
    table.check('longitude BETWEEN -180 AND 180', [], 'devices_longitude_range');
  });

  // Computed by PostgreSQL from latitude/longitude (for nearest-station queries), so it can never
  // disagree with them
  await knex.raw(`
    ALTER TABLE devices ADD COLUMN location geography(Point, 4326)
      GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography) STORED
  `);
  await knex.raw('CREATE INDEX devices_location_idx ON devices USING GIST (location)');
  await knex.raw(`
    CREATE TRIGGER devices_set_updated_at BEFORE UPDATE ON devices
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `);
};

exports.down = async (knex) => {
  await knex.schema.dropTable('devices');
  await knex.raw('DROP TYPE device_activity');
};
