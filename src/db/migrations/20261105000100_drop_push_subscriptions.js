// Push notifications are deprecated: the backend no longer sends them or accepts subscriptions (the
// /notifications endpoints, their service, repositories and copy script are removed), so their table
// goes too. The records stay in MongoDB, and in its final dump (Phase 4).
//
// Rolling back recreates the table empty, as migration 20261022000200 made it.
const createPushSubscriptions = require('./20261022000200_create_push_subscriptions');

exports.up = async (knex) => {
  await knex.schema.dropTable('push_subscriptions');
  await knex.raw('DROP TYPE subscription_status');
};

exports.down = async (knex) => {
  await createPushSubscriptions.up(knex);
};
