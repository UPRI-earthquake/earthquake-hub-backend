const MessagingService = require('../services/messaging.service')

// create helper middleware so we can reuse server-sent events
const SSEFormatting= (req, res, next) => {
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

const missedEventsResender = (req, res, next) => {
  var lastEventId = Number(req.headers['last-event-id'])
                    || Number(req.query.lastEventId)
  if(lastEventId){
    console.log('last-event-id:', lastEventId)
    const eventsToReSend = MessagingService.eventCache.cache.filter(e => e.id > lastEventId)

    eventsToReSend.forEach(event => {
      res.sendEventStreamData(
        event.name, JSON.stringify(event.data), event.id
      )
    })
  }
  next();
}

module.exports = {
  SSEFormatting,
  missedEventsResender
}



