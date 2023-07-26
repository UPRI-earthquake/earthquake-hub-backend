const EventEmitter = require('events')
const EventSource = require('eventsource');
const Devices = require('../models/device.model');
const Users = require('../models/account.model');
const EQEventsService = require('../services/events')
let sseConnectionsErrorFlag = 0;
let sseStreamsErrorFlag = 0;

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
      let updatedEvent = await EQEventsService.addPlaces([event]) // parse
      extendedEvent.data = updatedEvent[0]
      this.push(extendedEvent) // cache
      console.log(this.cache) // log SC_EVENT cache (not picks)
    }
    else if (channel === 'SC_PICK'){
      extendedEvent.data = event
    }

    this.emit("newEvent", extendedEvent) // emit

    return 'success'
  }
}
const eventCache = new EventCache(30); // record last 30 events\


/* --- External Event Sources --- */

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

  source.addEventListener('open', () => {
    console.log('Connection to /sse-connections opened');
  });

  source.addEventListener('error', (error) => {
    sseConnectionsErrorFlag += 1;
    if (sseConnectionsErrorFlag < 2) {
      console.log('Error connecting to /sse-connections: ', error);
    } 
    else if (sseConnectionsErrorFlag === 3) {
      console.log('Error connecting to /sse-connections. Will keep on retrying ...');
    }
  });
  
  source.addEventListener('close', () => {
    console.log('Connection to /sse-connections closed');
  });
}

// Routine to subscribe to ringserver /sse-streams endpoint
const sseStreamsEventListener = async() => {
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
        if (!latestStreamTimes[device.streamId]) {
          return; // skip to the next iteration
        }

        const current_utc_time = new Date(current_time).getTime();
        const latest_packet_time = latestStreamTimes[device.streamId].getTime();
        const activityToggleTime = device.activityToggleTime.getTime();
        const MAX_LAG_MS = 30 * 1000; // in milliseconds

        if (current_utc_time - latest_packet_time > MAX_LAG_MS){
          if (device.activity === 'active') {
            const deviceToUpdate = await Devices.findOne({ streamId: device.streamId })

            deviceToUpdate.activityToggleTime = latestStreamTimes[device.streamId];
            deviceToUpdate.activity = 'inactive';
            deviceToUpdate.save();
            return;
          } else { // Do nothing
            return;
          }
        }

        // latest_packet_time is within MAX_LAG; hence update device if necessary
        if (device.activity === 'inactive') {
          const deviceToUpdate = await Devices.findOne({ streamId: device.streamId })

          deviceToUpdate.activityToggleTime = latestStreamTimes[device.streamId];
          deviceToUpdate.activity = 'active';
          deviceToUpdate.save();
        }
    })
  });

  source.addEventListener('open', () => {
    console.log('Connection to /sse-streams opened');
  });

  source.addEventListener('error', (error) => {
    sseStreamsErrorFlag += 1;
    if (sseStreamsErrorFlag < 2) {
      console.log('Error connecting to /sse-streams: ', error);
    } 
    else if (sseStreamsErrorFlag === 3) {
      console.log('Error connecting to /sse-streams. Will keep on retrying ...');
    }
  });
  
  source.addEventListener('close', () => {
    console.log('Connection to /sse-streams closed');
  });
}

module.exports = {
  eventCache,
  sseConnectionsEventListener,
  sseStreamsEventListener,
}
