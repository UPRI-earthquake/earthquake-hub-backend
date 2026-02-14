const Subscription = require('../models/subscription.model');
const EQEventsService = require('../services/EQevents.service')

const mongoose = require('mongoose');
const webpush = require('web-push')
webpush.setVapidDetails(
  process.env.WEB_PUSH_CONTACT,
  process.env.PUBLIC_VAPID_KEY,
  process.env.PRIVATE_VAPID_KEY,
);

const minMagnitudeToNotify = 5.5 // Only notify when EQevent is stronger than this mag
const invalidCleanupDays = (() => {
  const n = Number.parseInt(process.env.NOTIF_INVALID_TTL_DAYS, 10);
  return Number.isFinite(n) && n > 0 ? n : 7;
})();
const INVALID_SUBSCRIPTION_CODES = new Set([400, 404, 410]);

const daysFromNow = (days, now = new Date()) => {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
};

const normalizeExpirationTime = (raw) => {
  if (raw === null || typeof raw === 'undefined') return null;
  const asNum = Number(raw);
  if (Number.isFinite(asNum)) return asNum;
  const asDate = new Date(raw).getTime();
  return Number.isFinite(asDate) ? asDate : null;
};

const normalizeOptionalDate = (raw) => {
  if (!raw) return null;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? new Date(ms) : null;
};

/***************************************************************************
  * notifySubscribersEQ:
  *     Notifies webpush subscribers about an earthquake event if its magnitude exceeds the minimum threshold set.
  * 
  * Inputs:
  *     message: Object       // An object representing the earthquake event message to be sent to subscribers.
  *                            // The object should have the following properties:
  *                            // - magnitude_value: number (the magnitude of the earthquake event).
  *                            // - text: string (additional text or description related to the earthquake event).
  * 
  * Outputs:
  *     "success":            if notifications were successfully sent to all subscribers.
  *     "dbNotAccessible":    if the function can't access subscriptions due to MongoDB not being connected.
  * 
  * Note:
  *     - If the magnitude is greater than the minimum threshold, the function calls EQEventsService.addPlacesAttribute to
  *       add location information to the earthquake event message.
  *     - If the subscriber's subscription is no longer valid (response status code is 400, 404, or 410), the function deletes the
  *       invalid subscription from the database.
 ***************************************************************************/
const notifySubscribersEQ = async (message) =>{
  if (!(message.magnitude_value > minMagnitudeToNotify)) {
    return 'success';
  }
  let updatedEvent = await EQEventsService.addPlacesAttribute([message])
  updatedEvent = updatedEvent[0]

  const place = updatedEvent.place
  const hasUsablePlace =
    place &&
    place.toString().trim().length > 0 &&
    place.toLowerCase() !== 'unavailable' &&
    place.toLowerCase() !== 'nominatim unavailable'

  const address = hasUsablePlace
    ? place
    : (updatedEvent.text || 'Unknown location')

  const eventTypeRaw = updatedEvent.eventType || message.eventType || 'NEW'
  const eventType = String(eventTypeRaw || '').toUpperCase()
  const publicID = updatedEvent.publicID || message.publicID || null
  const title = eventType === 'UPDATE' ? 'Earthquake Update' : 'Earthquake Alert'
  const payload = JSON.stringify({
    title,
    body: `Magnitude ${updatedEvent.magnitude_value} in ${address}`,
    data: {
      eventType,
      publicID,
      magnitude_value: updatedEvent.magnitude_value,
      place: address,
      last_modification: updatedEvent.last_modification || message.last_modification || null,
    },
  })

  if(mongoose.connection.readyState === 1) { // connected to MongoDB
    const subscribers = await Subscription.find({ status: { $ne: 'invalid' } });
    const sendTasks = subscribers.map((subscriber) => {
      return webpush
        .sendNotification(subscriber, payload)
        .then(async () => {
          console.log(`Sent notif to ${subscriber._id}`)
          const now = new Date();
          await Subscription.updateOne(
            { _id: subscriber._id },
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
        })
        .catch(async (err) => {
          const status = err && err.statusCode
          const now = new Date();
          if (INVALID_SUBSCRIPTION_CODES.has(status)) {
            console.log(`Subscription gone for ${subscriber._id}`)
            try {
              await Subscription.updateOne(
                { _id: subscriber._id },
                {
                  $set: {
                    status: 'invalid',
                    invalidatedAt: now,
                    cleanupAfter: daysFromNow(invalidCleanupDays, now),
                    lastFailureAt: now,
                    lastFailureCode: Number.isFinite(status) ? status : 410,
                  },
                  $inc: { consecutiveFailures: 1 },
                },
              );
            } catch (updateErr) {
              console.error(
                `Failed to mark ${subscriber._id} invalid:`,
                updateErr?.message || updateErr,
              );
            }
            return;
          }
          console.error(
            `Unhandled error in sendNotification():`,
            status || '',
            err?.message || err
          )
          try {
            await Subscription.updateOne(
              { _id: subscriber._id },
              {
                $set: {
                  lastFailureAt: now,
                  lastFailureCode: Number.isFinite(status) ? status : null,
                },
                $inc: { consecutiveFailures: 1 },
              },
            );
          } catch (updateErr) {
            console.error(
              `Failed to track failure for ${subscriber._id}:`,
              updateErr?.message || updateErr,
            );
          }
        });
    });
    await Promise.allSettled(sendTasks);
    return 'success'
  }else{
    console.warn("Can't access subscriptions, MongoDB not connected");
    return 'dbNotAccessible';
  }
}

/***************************************************************************
  * createSubscription:
  *     Creates a new subscription entry in the database for webpush notifications.
  * 
  * Inputs:
  *     subscriptionRequest: Object   // An object representing the subscription details for push notifications.
  *                                   // The object should contain the following properties:
  *                                   // - endpoint: string (the URL endpoint for push notifications).
  *                                   // - keys: Object (an object containing the authentication keys for push notifications).
  *                                   // See subscription model
  * 
  * Outputs:
  *     "success":                   if a new subscription entry was successfully created in the database.
  *     "subscriptionExists":        if a subscription entry with the same endpoint already exists in the database.
  *     "dbNotAccessible":           if the function can't create a new subscription due to MongoDB not being connected.
  * 
 ***************************************************************************/
const createSubscription = async (subscriptionRequest) =>{
  if(mongoose.connection.readyState === 1) { // connected to MongoDB
    const now = new Date();
    const expirationTime = normalizeExpirationTime(subscriptionRequest.expirationTime);
    const clientMeta = subscriptionRequest.clientMeta || {};
    const setDoc = {
      expirationTime,
      keys: subscriptionRequest.keys,
      status: 'active',
      lastSeenAt: now,
      consecutiveFailures: 0,
      clientMeta: {
        userAgent: clientMeta.userAgent || null,
        appVersion: clientMeta.appVersion || null,
        clientTime: normalizeOptionalDate(clientMeta.time),
      },
    };
    if (typeof clientMeta.swScriptUrl === 'string' && clientMeta.swScriptUrl.trim()) {
      setDoc.sourceSwScript = clientMeta.swScriptUrl.trim();
    }

    const writeResult = await Subscription.findOneAndUpdate(
      { endpoint: subscriptionRequest.endpoint },
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
        rawResult: true,
        setDefaultsOnInsert: true,
      },
    );
    const wasCreated = Boolean(
      writeResult && writeResult.lastErrorObject && writeResult.lastErrorObject.upserted,
    );
    if(!wasCreated){
      console.log('Old subscription found');
      return 'subscriptionExists';
    }

    console.log('New subscription created')
    return 'success'

  }else{
    console.warn("Can't create new subscription, MongoDB not connected");
    return 'dbNotAccessible'
  }
}

module.exports = {
  notifySubscribersEQ,
  createSubscription
}
