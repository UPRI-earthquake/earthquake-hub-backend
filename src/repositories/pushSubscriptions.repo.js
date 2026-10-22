// Data access for web-push subscriptions. Services use this module instead of a database client, so
// the area can switch databases with PUSH_SUBSCRIPTIONS_DB (mongodb | postgres) and no other change.
// See either implementation for the functions it provides; both pass the same integration tests.
const { selectRepository } = require('../db/areaDatabase');

module.exports = selectRepository('push subscriptions', 'PUSH_SUBSCRIPTIONS_DB', {
  mongodb: () => require('./mongodb/pushSubscriptions.repo'),
  postgres: () => require('./postgres/pushSubscriptions.repo').createPushSubscriptionsRepo(require('../db/knex').db),
});
