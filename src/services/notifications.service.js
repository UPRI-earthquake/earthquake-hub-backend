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
  if(message.magnitude_value > minMagnitudeToNotify){
    let updatedEvent = await EQEventsService.addPlacesAttribute([message])
    updatedEvent = updatedEvent[0]

    let address = ''
    updatedEvent.place === 'Nominatim unavailable'
    ? address = updatedEvent.text
    : address = updatedEvent.place

    const payload = JSON.stringify({
      title: 'Earthquake Alert',
      body: `Magnitude ${updatedEvent.magnitude_value} in ${address}`,
    })

    if(mongoose.connection.readyState === 1) { // connected to MongoDB
      const subscribers = await Subscription.find({});
      subscribers.forEach(subscriber => {
        webpush.sendNotification(subscriber, payload)
          .then(console.log(`Sent notif to ${subscriber._id}`))
          .catch(response => {
            switch(response.statusCode){
              case 400:
              case 404: // Not Found
              case 410:
                console.log(`Subscription gone for ${subscriber._id}`)
                Subscription.deleteOne(subscriber)
                .then(console.log(`Deleted ${subscriber.id}`))
                break;
              default:
                console.log(`Unhandled response in of sendNotification(): ${response.statusCode}`)
            }
          })
      })
      return 'success'
    }else{
      console.warn("Can't access subscriptions, MongoDB not connected");
      return 'dbNotAccessible';
    }
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

    const subExists = await Subscription.exists(
      {endpoint: subscriptionRequest.endpoint}
    )

    if(subExists){
      console.log('Old subscription found');
      return 'subscriptionExists';
    }

    const subscription = new Subscription(subscriptionRequest);
    await subscription.save();
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
