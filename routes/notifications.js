const express = require('express');
const Subscription = require('../models/subscription');
const events = require('../services/events')
const mongoose = require('mongoose');
const redis = require("redis")
const webpush = require('web-push')
const config = require('../config')
require('dotenv').config({path: __dirname + '/../.env'})


const router = express.Router();
router.post('/subscribe', async (req,res) => {
  const subscriptionRequest = req.body // TODO: Validate request body
  const subExists = await Subscription.exists(
    {endpoint: subscriptionRequest.endpoint}
  )
  if(subExists){
    console.log('Old subscription found')
  }else{
    console.log(subExists)
    console.log('New subscription created')
    const subscription = new Subscription(subscriptionRequest);
    const savedSubscription = await subscription.save();
  }

  // send 201 - resource created
  res.status(201).json({'success': true})
})


// redis real-time comms with SC, and broadcasts notifs
var subscriber;
const redisProxy = async (new_config) =>{
  webpush.setVapidDetails(
    process.env.WEB_PUSH_CONTACT,
    process.env.PUBLIC_VAPID_KEY,
    process.env.PRIVATE_VAPID_KEY,
  );

  try {
    subscriber = redis.createClient(new_config ? new_config : config.redis);
    await subscriber.connect()
    await subscriber.pSubscribe("SC_EVENT", async (message, channel) => {
      console.log(`notifications.js received: ${channel}`)
      message = JSON.parse(message)

      if(message.magnitude_value > 5.5){
        let updatedEvent = await events.addPlaces([message])
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
        }else{
          console.warn("Can't access subscriptions, MongoDB not connected");
        }
      }
    });
  } catch (err) {
    console.trace(`In Redis setup...\n ${err}`)
    //TODO: properly handle this scenario
  }
}
const quitRedisProxy = async () => {
  subscriber && (await subscriber.quit())
}

module.exports = {router, redisProxy, quitRedisProxy}
