// Replaces the MongoDB `subscriptions` collection. Copy existing data with
// scripts/copy-subscriptions-to-postgres.js. Invalid subscriptions past cleanup_after are deleted by
// the cleanup scheduler (subscriptionCleanup.service.js), which replaces MongoDB's TTL index.

exports.up = async (knex) => {
  await knex.schema.createTable('push_subscriptions', (table) => {
    table.comment('One browser subscribed to web-push earthquake notifications');
    table.uuid('id').primary().defaultTo(knex.raw('uuidv7()'));
    table.specificType('legacy_mongo_id', 'char(24)').unique()
      .comment('_id of the MongoDB document this row was copied from');
    // The foreign key to accounts is added once accounts move to PostgreSQL (Step 2)
    table.uuid('account_id').comment('optional: the account that subscribed');
    table.text('endpoint').notNullable().unique();
    table.bigInteger('expiration_time').comment('epoch milliseconds, as given by the browser');
    table.text('key_auth').notNullable();
    table.text('key_p256dh').notNullable();
    table.enu('status', ['active', 'invalid'], { useNative: true, enumName: 'subscription_status' })
      .notNullable().defaultTo('active');
    table.timestamp('last_seen_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('last_delivered_at', { useTz: true });
    table.timestamp('last_failure_at', { useTz: true });
    table.integer('last_failure_code').comment('HTTP status from the push service');
    table.integer('consecutive_failures').notNullable().defaultTo(0);
    table.timestamp('invalidated_at', { useTz: true });
    table.timestamp('cleanup_after', { useTz: true }).comment('invalid rows are deleted after this');
    table.text('source_sw_script');
    table.text('client_user_agent');
    table.text('client_app_version');
    table.timestamp('client_time', { useTz: true });
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['status', 'last_seen_at']);
    table.index('cleanup_after');
  });
  await knex.raw(`
    CREATE TRIGGER push_subscriptions_set_updated_at BEFORE UPDATE ON push_subscriptions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `);
};

exports.down = async (knex) => {
  await knex.schema.dropTable('push_subscriptions');
  await knex.raw('DROP TYPE subscription_status');
};
