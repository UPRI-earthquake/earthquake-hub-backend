const express = require('express');
const Subscription = require('../models/subscription');
const mongoose = require('mongoose');

const router = express.Router();

router.post('/subscribe', async (req,res) => {
  if(mongoose.connection.readyState === 1) { // connected to MongoDB
    const subscriptionRequest = req.body // TODO: Validate request body
    const subExists = await Subscription.exists(
      {endpoint: subscriptionRequest.endpoint}
    )
    if(subExists){
      console.log('Old subscription found')
    }else{
      console.log(subExists)
      const subscription = new Subscription(subscriptionRequest);
        const savedSubscription = await subscription.save();
        console.log('New subscription created')
        res.status(201).json({'success': true}) // send 201 - resource created
    }
  }else{
    console.warn("Can't create new subscription, MongoDB not connected");
    res.status(500).json({'success': false}) // send 500 - resource not created
  }
})

module.exports = router

