const redis = require('redis');
const express = require('express');
const router = express.Router();
const events = require('../services/events')
const EventEmitter = require('events')

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

  async newEvent(pattern, channel, event) {
    var extendedEvent = {
      name: channel,
      id: Date.now() // int timestamp in ms
    }

    // Get data
    if(channel === 'SC_EVENT'){
      let updatedEvent = await events.addPlaces([JSON.parse(event)]) // parse
      extendedEvent.data = updatedEvent[0]
      this.push(extendedEvent) // cache
    }
    else if (channel === 'SC_PICK'){
      extendedEvent.data = JSON.parse(event)
    }

    this.emit("newEvent", extendedEvent) // emit
    console.log(this.cache)
  }
}
const eventCache = new EventCache(30) // record last 30 events\
// Setup Redis pubsub subscriber, and Event Emitter
const redis_channel = "SC_*" // SC_PICK or SC_EVENT
const redis_host = "172.17.0.2"
const subscriber = redis.createClient({host:redis_host})
subscriber.psubscribe(redis_channel)
subscriber.on("pmessage", (pattern, channel, event) =>{
  console.log('channel:',channel)
  eventCache.newEvent(pattern, channel, event)
});

// create helper middleware so we can reuse server-sent events
const useServerSentEventsMiddleware = (req, res, next) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
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
  if(req.headers['last-event-id']){
    const eventId = parseInt(req.headers['last-event-id']);
    console.log('last-event-id:', eventId)
    const eventsToReSend = eventCache.cache.filter(e => e.id>eventId)

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

    function logAndSend(event) {
      console.log(`Sending SSE: ${req.ip}\n`, event);
      res.sendEventStreamData(
        event.name, JSON.stringify(event.data), event.id
      )
    }

    eventCache.on("newEvent", logAndSend);

    res.on('close', () => {
      eventCache.removeListener('newEvent', logAndSend)
      res.end();
      console.log('SSE connection closed:', req.ip)
    });
});

module.exports = router
