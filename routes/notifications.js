const express = require('express');
const Subscription = require('../models/subscription');
const mongodb = require('../services/mongodb')
const events = require('../services/events')
const redis = require("redis")
const webpush = require('web-push')
const config = require('../config')

mongodb.connect();

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
const proxy = () =>{
  const redisChannel = "SC_*" // SC_PICK or SC_EVENT
  const redisClient = redis.createClient(config.redis)
  redisClient.psubscribe(redisChannel)

  webpush.setVapidDetails(
    process.env.WEB_PUSH_CONTACT,
    process.env.PUBLIC_VAPID_KEY,
    process.env.PRIVATE_VAPID_KEY,
  )
  redisClient.on("pmessage", async (pattern, channel, message) => {
    if(channel === "SC_EVENT"){
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
      }
    }
  });
}

module.exports = {router, proxy}
