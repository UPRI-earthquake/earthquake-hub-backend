// Released devices keep the released device's MongoDB-style id (devices.legacy_mongo_id), which the
// API returns as releasedDevices[].deviceId. Stored here, not joined from devices, because a device
// can be deleted after it was released (device_id becomes NULL) and MongoDB kept the id in the
// history regardless. Existing rows are filled in from their device where it still exists.

exports.up = async (knex) => {
  await knex.schema.alterTable('device_releases', (table) => {
    table.specificType('device_legacy_mongo_id', 'char(24)')
      .comment('MongoDB-style id of the released device (API: deviceId); kept after the device is deleted');
  });
  await knex.raw(`
    UPDATE device_releases r SET device_legacy_mongo_id = d.legacy_mongo_id
      FROM devices d WHERE d.id = r.device_id AND r.device_legacy_mongo_id IS NULL
  `);
};

exports.down = async (knex) => {
  await knex.schema.alterTable('device_releases', (table) => {
    table.dropColumn('device_legacy_mongo_id');
  });
};
