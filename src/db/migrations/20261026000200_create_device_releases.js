// Replaces the releasedDevices[] array embedded in MongoDB accounts: one row per time an account
// unlinked a device, with a snapshot of the device as it was then. History only.
//
// legacy_mongo_id (not in postgres-schema.dbml) holds the _id of the embedded MongoDB entry, so the
// copy script can be re-run without duplicating history.

exports.up = async (knex) => {
  await knex.schema.createTable('device_releases', (table) => {
    table.comment('A device an account unlinked, as the device was at that moment');
    table.uuid('id').primary().defaultTo(knex.raw('uuidv7()'));
    table.specificType('legacy_mongo_id', 'char(24)').unique()
      .comment('_id of the releasedDevices[] entry this row was copied from');
    table.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE')
      .comment('who released it; their history goes with the account');
    table.uuid('device_id').references('id').inTable('devices').onDelete('SET NULL')
      .comment('null if the device was later deleted');
    table.string('network', 8);
    table.string('station', 16);
    table.text('stream_id');
    table.text('mac_address');
    table.text('description');
    table.double('latitude');
    table.double('longitude');
    table.double('elevation_m');
    table.text('reason').notNullable().defaultTo('unlink');
    table.timestamp('released_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['account_id', 'released_at']);
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTable('device_releases');
};
