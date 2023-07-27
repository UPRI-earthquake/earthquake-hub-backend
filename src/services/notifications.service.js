const Subscription = require('../models/subscription');
const EQEventsService = require('../services/EQevents.service')

const mongoose = require('mongoose');
const webpush = require('web-push')
webpush.setVapidDetails(
  process.env.WEB_PUSH_CONTACT,
  process.env.PUBLIC_VAPID_KEY,
  process.env.PRIVATE_VAPID_KEY,
);

const minMagnitudeToNotify = 5.5 // Only notify when EQevent is stronger than this mag

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
              case 410:
                console.log(`Subscription gone for ${subscriber._id}`)
                Subscription.deleteOne(subscriber)
                .then(console.log(`Deleted ${subscriber.id}`))
                break;
              default:
                console.log(JSON.parse(e.body))
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
