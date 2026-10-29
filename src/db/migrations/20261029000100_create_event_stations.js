// Replaces events.candidateStations[] and recordingStations[], which MongoDB stored as station codes
// ("R3B2D") that nothing tied to a real device. Here each entry points to its device, so:
//   - every station on an earthquake is a real device
//   - "which earthquakes did this station record?" is one indexed query
//   - a device that appears in earthquake history can't be deleted (ON DELETE RESTRICT), only
//     unlinked: POST /device/reset-link clears such a device instead of deleting it
// onlineStations isn't stored: it's worked out from these rows and the event's recording status.

exports.up = async (knex) => {
  await knex.schema.createTable('event_stations', (table) => {
    table.comment('A station (device) near an earthquake: a candidate at ingest, or one confirmed to have recorded it');
    table.uuid('event_id').notNullable().references('id').inTable('events').onDelete('CASCADE');
    table.uuid('device_id').notNullable().references('id').inTable('devices').onDelete('RESTRICT').index()
      .comment('the station');
    table.enu('kind', ['candidate', 'recording'], { useNative: true, enumName: 'station_kind' }).notNullable()
      .comment('candidate: nearest active station at ingest; recording: FDSN has its waveform data');
    table.smallint('position').notNullable().comment('order in the list, nearest first');

    table.primary(['event_id', 'device_id', 'kind']);
    // One station per place in each list, so the order is always defined
    table.unique(['event_id', 'kind', 'position']);
    table.check('position >= 0', [], 'event_stations_position_not_negative');
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTable('event_stations');
  await knex.raw('DROP TYPE station_kind');
};
