const redis = require('redis');
const express = require('express');
const router = express.Router();
const events = require('../services/events')

// Setup Redis pubsub subscriber, and Event Emitter
const redis_channel = "SC_*" // SC_PICK or SC_EVENT
const redis_host = "172.17.0.2"
const subscriber = redis.createClient({host:redis_host})
subscriber.psubscribe(redis_channel)

// create helper middleware so we can reuse server-sent events
const useServerSentEventsMiddleware = (req, res, next) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();

    const sendEventStreamData = (eventName, data) => {
      res.write(`event: ${eventName}\n`);
      res.write(`data: ${data}\n\n`);
    }

    // we are attaching sendEventStreamData to res, so we can use it later
    Object.assign(res, {
      sendEventStreamData
    });

    next();
}

router.get('/', useServerSentEventsMiddleware, (req, res) => {
  console.log('SSE connection opened:', req.ip)

  async function logAndSend(pattern, channel, message) {
    var updatedEvent = await events.addPlaces([JSON.parse(message)])
    console.log(`Sending SSE: ${req.ip}\n`, updatedEvent[0]);
    res.sendEventStreamData(channel, JSON.stringify(updatedEvent[0]))
  }

  subscriber.on("pmessage", logAndSend);

  res.on('close', () => {
    subscriber.removeListener('pmessage', logAndSend)
    res.end();
    console.log('SSE connection closed:', req.ip)
  });
});

module.exports = router
