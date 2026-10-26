// The sensors a barangay forwards data for. In MongoDB these sat in the brgy account's devices[]
// array next to devices it owned; here ownership is devices.owner_account_id and forwarding is this
// table, so the two can't be confused. A sensor's owner verifying with a brgy adds a row
// (accounts.service verifySensorToken); unlinking the sensor removes it.
//
// Deleting the brgy account or the device removes the link (both foreign keys cascade).

exports.up = async (knex) => {
  await knex.schema.createTable('brgy_forwarded_devices', (table) => {
    table.comment('A sensor whose data a barangay ringserver forwards (the sensor belongs to another account)');
    table.uuid('brgy_account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    table.uuid('device_id').notNullable().references('id').inTable('devices').onDelete('CASCADE').index();
    table.timestamp('added_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
      .comment("orders a brgy's list, oldest first");

    table.primary(['brgy_account_id', 'device_id']);
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTable('brgy_forwarded_devices');
};
