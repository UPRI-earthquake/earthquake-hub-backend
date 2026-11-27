// Replaces the MongoDB `accounts` collection. Its devices[] and releasedDevices[] arrays become
// devices.owner_account_id and the device_releases table (next migrations).
//
// The database now enforces what the app checked by hand: one account per email and per username,
// compared without regard to case (citext), and one brgy account per ringserver URL.

exports.up = async (knex) => {
  await knex.raw("CREATE TYPE account_role AS ENUM ('citizen', 'sensor', 'brgy', 'admin')");

  await knex.schema.createTable('accounts', (table) => {
    table.comment('One user: a citizen (who may own sensors), a barangay, or an admin');
    table.uuid('id').primary().defaultTo(knex.raw('uuidv7()'));
    table.specificType('legacy_mongo_id', 'char(24)').unique()
      .comment('_id of the MongoDB document this row was copied from');
    table.specificType('email', 'citext').notNullable().unique().comment('compared case-insensitively');
    table.specificType('username', 'citext').notNullable().unique().comment('compared case-insensitively');
    table.text('password_hash').notNullable().comment('bcrypt; never returned by the API');
    table.specificType('roles', 'account_role[]').notNullable().defaultTo(knex.raw("'{}'"));
    table.boolean('is_approved').notNullable().defaultTo(false).comment('brgy accounts need admin approval');
    table.integer('password_policy_version').notNullable().defaultTo(1);
    table.timestamp('password_updated_at', { useTz: true });
    table.text('password_reset_token_id').comment('SHA-256 of the reset token id; single use');
    table.timestamp('password_reset_issued_at', { useTz: true });
    table.timestamp('password_reset_used_at', { useTz: true });
    table.text('ringserver_url').unique().comment('brgy accounts only');
    table.integer('ringserver_port');
    table.boolean('rshake_email_enabled').notNullable().defaultTo(false).comment('device alert emails');
    table.timestamp('alert_prefs_updated_at', { useTz: true });
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.check("btrim(email::text) <> ''", [], 'accounts_email_not_blank');
    table.check("btrim(username::text) <> ''", [], 'accounts_username_not_blank');
    table.check('ringserver_port BETWEEN 1 AND 65535', [], 'accounts_ringserver_port_range');
  });

  await knex.raw(`
    CREATE TRIGGER accounts_set_updated_at BEFORE UPDATE ON accounts
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `);
};

exports.down = async (knex) => {
  await knex.schema.dropTable('accounts');
  await knex.raw('DROP TYPE account_role');
};
