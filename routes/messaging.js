const redis = require('redis');
const express = require('express');
const router = express.Router();
const EventEmitter = require('events')
const events = require('../services/events')

// define EQ event multiplexer/parse-cache-middleware
class EventCache extends EventEmitter {
  constructor(maxEvents) {
    super();
    this.cache = []; //queue of fixed length
    this.maxLength = maxEvents;
  }

  push(event) {
    this.cache.push(event)
    if (this.cache.length > this.maxLength) {
      this.cache.shift() // remove 1st elem, then shift left O(n)
    }
  }

  async newEvent(pattern, event, channel) {
    var extendedEvent = {
      name: channel,
      id: Date.now() // int timestamp in ms
    }

    // Get data
    if(channel === 'SC_EVENT'){
      let updatedEvent = await events.addPlaces([JSON.parse(event)]) // parse
      extendedEvent.data = updatedEvent[0]
      this.push(extendedEvent) // cache
      console.log(this.cache) // log SC_EVENT cache (not picks)
    }
    else if (channel === 'SC_PICK'){
      extendedEvent.data = JSON.parse(event)
    }

    this.emit("newEvent", extendedEvent) // emit
  }
}
const eventCache = new EventCache(30); // record last 30 events\

// Setup Redis pubsub subscriber, and Event Emitter (emits events per SC msg)
var subscriber;
const redisProxy = async (new_config) =>{
  try {
    const redis_channel = "SC_*"; // SC_PICK or SC_EVENT
    subscriber = redis.createClient(new_config ? new_config : {
      url:`redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`
    });
    await subscriber.connect(); // TODO: add reconnect strategy with dev options,
                                // currently, this will repeatedly retry (albeit silently)
    await subscriber.pSubscribe(redis_channel,  (message, channel) =>{
      console.log(`messaging.js received: ${channel}`);
      eventCache.newEvent(redis_channel, message, channel);
    });
  } catch (err) {
    console.trace(`In Redis setup...\n ${err}`)
    //TODO: properly handle this scenario
  }
}
const quitRedisProxy = async () => {
  subscriber && (await subscriber.quit())
}

// create helper middleware so we can reuse server-sent events
const useServerSentEventsMiddleware = (req, res, next) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  const sendEventStreamData = (eventName, data, id) => {
    if(!res.finished){
      res.write(`event: ${eventName}\n`);
      res.write(`data: ${data}\n`);
      res.write(`id: ${id}\n`);
      res.write(`\n\n`);
    }
  }

  // we are attaching sendEventStreamData to res, so we can use it later
  Object.assign(res, {
    sendEventStreamData
  });

  next();
}

const useMissedEventsResender = (req, res, next) => {
  var lastEventId = Number(req.headers['last-event-id'])
                    || Number(req.query.lastEventId)
  if(lastEventId){
    console.log('last-event-id:', lastEventId)
    const eventsToReSend = eventCache.cache.filter(e => e.id > lastEventId)

    eventsToReSend.forEach(event => {
      res.sendEventStreamData(
        event.name, JSON.stringify(event.data), event.id
      )
    })
  }
  next();
}

router.get('/',
  useServerSentEventsMiddleware,
  useMissedEventsResender,
  (req, res) => {
    console.log('SSE connection opened:', req.ip)

    // send new event
    function sendEvent(event){
      console.log(`Sending SSE: ${req.ip}\n`, event);
      res.sendEventStreamData(
        event.name, JSON.stringify(event.data), event.id
      )
    }
    eventCache.on("newEvent", sendEvent);

    // send heartbeats every 15 sec (client detects dead connx w/in 45 secs)
    var heartbeat = setInterval(() => {
      if(!res.finished) {
        res.write(': heartbeat\n\n')
      }
    }, 15000);

    res.on('close', () => {
      clearInterval(heartbeat);
      eventCache.removeListener('newEvent', sendEvent);
      res.end();
      console.log('SSE connection closed:', req.ip)
    });
});

module.exports = {router, redisProxy, quitRedisProxy, eventCache}
