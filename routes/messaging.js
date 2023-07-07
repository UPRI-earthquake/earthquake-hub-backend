const express = require('express');
const router = express.Router();
const EventEmitter = require('events')
const EventSource = require('eventsource');
const events = require('../services/events')
const Devices = require('../models/device.model');
const Users = require('../models/account.model');

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
      let updatedEvent = await events.addPlaces([event]) // parse
      extendedEvent.data = updatedEvent[0]
      this.push(extendedEvent) // cache
      console.log(this.cache) // log SC_EVENT cache (not picks)
    }
    else if (channel === 'SC_PICK'){
      extendedEvent.data = event
    }

    this.emit("newEvent", extendedEvent) // emit
  }
}
const eventCache = new EventCache(30); // record last 30 events\

// Routine to subscribe to ringserver /sse-connections endpoint
const sseConnectionsEventListener = async() => {
  const ringserver_ip = `http://${process.env.RINGSERVER_HOST}:${process.env.RINGSERVER_PORT}`;
  const source = new EventSource(`${ringserver_ip}/sse-connections`)

  source.addEventListener('ringserver-connections-status', async (event) => {
    const { connections } = JSON.parse(event.data);
  
    // Filter connections with role === 'sensor'
    const ringserverConnections = connections.filter(
      (connection) => connection.role === 'sensor'
    );
  
    // Save current_time to MongoDB for sensor connections
    ringserverConnections.forEach( async (user) => {
      const userUpdate = await Users.findOne({ username: user.username })

      userUpdate.updatedAt = connections.current_time;
      userUpdate.save();
    });
  });
  
  source.addEventListener('close', () => {
    console.log('Connection to /sse-connections closed');
    // Handle SSE connection closure
  });
}

// Routine to subscribe to ringserver /sse-streams endpoint
const sseStreamidsEventListener = async() => {
  const ringserver_ip = `http://${process.env.RINGSERVER_HOST}:${process.env.RINGSERVER_PORT}`;
  const source = new EventSource(`${ringserver_ip}/sse-streams`)

  source.addEventListener('ringserver-streamids-status', async (event) => {
    const { stream_ids, current_time } = JSON.parse(event.data);

    /*
      .reduce() - applies function to each object in array 
    */
    const latestStreamTimes = stream_ids.reduce((accumulated, stream_obj) => {
      const stream_id_split = stream_obj.stream_id.split("_"); 
      const newStreamId = `${stream_id_split[0]}_${stream_id_split[1]}_.*/MSEED`;

      if (!accumulated[newStreamId]) { 
        // assign latest_data_end_time as {newStreamId:latestTime}
        accumulated[newStreamId] = new Date(stream_obj.latest_data_end_time); // assumed as latest time
      } else {
        // get time for this row and latestTime so far
        const objTime = new Date(stream_obj.latest_data_end_time).getTime();
        const latestTime = accumulated[newStreamId].getTime();

        // update latestTime if objTime is later
        if (objTime > latestTime) {
          accumulated[newStreamId] = new Date(stream_obj.latest_data_end_time);
        }
      }

      return accumulated;
    }, {});

    const devices = await Devices.find();

    devices.forEach( async (device) => {
      // Object.keys(latestStreamTimes).forEach( async (stream_id, key) => {
        // console.log(device.streamId)
        if (!latestStreamTimes[device.streamId]) {
          return; // skip to the next iteration
        }

        const current_utc_time = new Date(current_time).getTime();
        const latest_packet_time = latestStreamTimes[device.streamId].getTime();
        const lastConnectedTime = device.lastConnectedTime.getTime();
        const MAX_LAG_MS = 30 * 1000; // in milliseconds

        if (current_utc_time - latest_packet_time > MAX_LAG_MS){
          if (device.activity === 'active') {
            const deviceToUpdate = await Devices.findOne({ streamId: device.streamId })

            deviceToUpdate.activity = 'inactive';
            deviceToUpdate.save();
            return;
          } else { // Do nothing
            return;
          }
        }

        // latest_packet_time is within MAX_LAG; hence update device if necessary

        if (latest_packet_time > lastConnectedTime) {
          const deviceToUpdate = await Devices.findOne({ streamId: device.streamId })

          deviceToUpdate.lastConnectedTime = latestStreamTimes[device.streamId];
          deviceToUpdate.save();
        }

        if (device.activity === 'inactive') {
          const deviceToUpdate = await Devices.findOne({ streamId: device.streamId })

          deviceToUpdate.activity = 'active';
          deviceToUpdate.save();
        }
      // })
    })
  });
  
  source.addEventListener('close', () => {
    console.log('Connection to /sse-streams closed');
    // Handle SSE connection closure
  });
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

const addEventToSSE = async (req, res, next) => {
  try {
    console.log('Adding new event to SSE')
    await eventCache.newEvent("SC_*", req.body, "SC_EVENT");
    next();
  } catch (error) {
    next(error);
  }
}

router.post('/new-event', 
  addEventToSSE,
  events.addEvent
);

router.post('/new-pick', async (req, res) => {
  try {
    console.log('Adding new pick to SSE')
    await eventCache.newEvent("SC_*", req.body, "SC_PICK");
    res.status(200).json({message: "Pick received"})
  } catch (error) {
    res.status(500).json({error: error})
  }
});

module.exports = {
  router, 
  eventCache, 
  sseConnectionsEventListener, 
  sseStreamidsEventListener
}
