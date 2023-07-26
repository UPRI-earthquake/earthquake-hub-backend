const MessagingService = require('../services/messaging.service')
const events = require('../services/events')

exports.setupSSEConnection = async (req, res, next) => {
  console.log('SSE connection opened:', req.ip)

  function sendEvent(event){
    console.log(`Sending SSE: ${req.ip}\n`, event);
    res.sendEventStreamData(
      event.name, JSON.stringify(event.data), event.id
    )
  }
  MessagingService.eventCache.on("newEvent", sendEvent);

  // send heartbeats every 15 sec (client detects dead connx w/in 45 secs)
  var heartbeat = setInterval(() => {
    if(!res.writableEnded) {
      res.write(': heartbeat\n\n')
    }
  }, 15000);

  res.on('close', () => {
    clearInterval(heartbeat);
    MessagingService.eventCache.removeListener('newEvent', sendEvent);
    res.end();
    console.log('SSE connection closed:', req.ip)
  });
}

exports.newEvent = async (req, res, next) => {
  try {
    console.log('Adding new event to SSE')
    await MessagingService.eventCache.newEvent("SC_*", req.body, "SC_EVENT");
    events.addEvent (req, res)
  } catch (error) {
    next(error);
  }
}

exports.newPick = async (req, res, next) => {
  try {
    console.log('Adding new pick to SSE')
    await MessagingService.eventCache.newEvent("SC_*", req.body, "SC_PICK");
    res.status(200).json({message: "Pick received"})
  } catch (error) {
    res.status(500).json({error: error})
  }
}

