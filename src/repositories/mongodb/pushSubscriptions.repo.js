// Push subscriptions in MongoDB (`subscriptions` collection): the implementation used when
// PUSH_SUBSCRIPTIONS_DB=mongodb. Keep it behaving like postgres/pushSubscriptions.repo.js: both must
// pass __tests__/pushSubscriptions.repo.integration.test.js.
//
// Write functions take `now` from the caller, so one operation uses a single timestamp throughout.
const mongoose = require('mongoose');
const Subscription = require('../../models/subscription.model');

const toSubscriber = (doc) => ({
  id: String(doc._id),
  endpoint: doc.endpoint,
  expirationTime: doc.expirationTime ?? null,
  // Optional chaining: a malformed record should fail its own delivery, not the whole list
  keys: { p256dh: doc.keys?.p256dh, auth: doc.keys?.auth },
});

// Resolves to whether the database can be queried right now (callers skip their work instead of waiting)
const isAvailable = async () => mongoose.connection.readyState === 1;

/***************************************************************************
  * upsert:
  *     Creates a subscription, or refreshes the one with the same endpoint: marks it active,
  *     updates its keys and client details, and clears its failure history.
  *
  * Inputs:
  *     subscription: { endpoint, expirationTime, keys: { p256dh, auth },
  *                     clientMeta: { userAgent, appVersion, clientTime },
  *                     sourceSwScript }   // sourceSwScript optional; left unchanged when absent
  *     now: Date
  *
  * Outputs:
  *     { created: boolean }   // false when a subscription with this endpoint already existed
 ***************************************************************************/
async function upsert(subscription, now) {
  const setDoc = {
    expirationTime: subscription.expirationTime,
    keys: subscription.keys,
    status: 'active',
    lastSeenAt: now,
    consecutiveFailures: 0,
    clientMeta: subscription.clientMeta,
  };
  if (subscription.sourceSwScript) {
    setDoc.sourceSwScript = subscription.sourceSwScript;
  }

  const writeResult = await Subscription.findOneAndUpdate(
    { endpoint: subscription.endpoint },
    {
      $set: setDoc,
      $unset: {
        invalidatedAt: '',
        cleanupAfter: '',
        lastFailureAt: '',
        lastFailureCode: '',
      },
    },
    {
      upsert: true,
      new: true,
      // Mongoose 8 replaced `rawResult` with this (and ignores the old name)
      includeResultMetadata: true,
      setDefaultsOnInsert: true,
    },
  );

  return {
    created: Boolean(
      writeResult && writeResult.lastErrorObject && writeResult.lastErrorObject.upserted,
    ),
  };
}

// Subscriptions that should receive notifications: [{ id, endpoint, expirationTime, keys }]
async function listActive() {
  const docs = await Subscription.find({ status: { $ne: 'invalid' } }).lean();
  return docs.map(toSubscriber);
}

// A notification reached the subscriber: active again, failure history cleared
async function recordDelivery(id, now) {
  await Subscription.updateOne(
    { _id: id },
    {
      $set: {
        status: 'active',
        lastDeliveredAt: now,
        consecutiveFailures: 0,
      },
      $unset: {
        lastFailureAt: '',
        lastFailureCode: '',
        invalidatedAt: '',
        cleanupAfter: '',
      },
    },
  );
}

// A delivery failed for a reason that may be temporary; `code` is the HTTP status, or null
async function recordFailure(id, code, now) {
  await Subscription.updateOne(
    { _id: id },
    {
      $set: {
        lastFailureAt: now,
        lastFailureCode: code,
      },
      $inc: { consecutiveFailures: 1 },
    },
  );
}

// The push service says the subscription is gone (`code`): stop sending, delete after `cleanupAfter`
async function markInvalid(id, { code, cleanupAfter, now }) {
  await Subscription.updateOne(
    { _id: id },
    {
      $set: {
        status: 'invalid',
        invalidatedAt: now,
        cleanupAfter,
        lastFailureAt: now,
        lastFailureCode: code,
      },
      $inc: { consecutiveFailures: 1 },
    },
  );
}

// Invalidates subscriptions whose browser-given expirationTime has passed. Resolves to the count.
async function markExpiredInvalid({ cleanupAfter, now }) {
  const result = await Subscription.updateMany(
    {
      status: { $ne: 'invalid' },
      expirationTime: { $type: 'number', $lte: now.getTime() },
    },
    {
      $set: {
        status: 'invalid',
        invalidatedAt: now,
        cleanupAfter,
        lastFailureAt: now,
        lastFailureCode: 410,
      },
    },
  );
  return result.modifiedCount || 0;
}

// Invalidates active subscriptions not seen since `staleCutoff` that failed at least
// `failureThreshold` times in a row. Resolves to the count.
async function markStaleInvalid({ staleCutoff, failureThreshold, cleanupAfter, now }) {
  const result = await Subscription.updateMany(
    {
      status: 'active',
      lastSeenAt: { $lte: staleCutoff },
      consecutiveFailures: { $gte: failureThreshold },
    },
    {
      $set: {
        status: 'invalid',
        invalidatedAt: now,
        cleanupAfter,
      },
    },
  );
  return result.modifiedCount || 0;
}

// Deletes invalid subscriptions whose cleanupAfter has passed. Resolves to the count.
// (The TTL index handles this eventually, but an explicit delete keeps the collection tidy sooner.)
async function deleteExpired(now) {
  const result = await Subscription.deleteMany({
    status: 'invalid',
    cleanupAfter: { $type: 'date', $lte: now },
  });
  return result.deletedCount || 0;
}

module.exports = {
  isAvailable,
  upsert,
  listActive,
  recordDelivery,
  recordFailure,
  markInvalid,
  markExpiredInvalid,
  markStaleInvalid,
  deleteExpired,
};
