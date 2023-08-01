const EventEmitter = require('events')
const EventSource = require('eventsource');

const Devices = require('../models/device.model');
const Users = require('../models/account.model');

const EQEventsService = require('./EQevents.service')

let sseConnectionsErrorFlag = 0;
let sseStreamsErrorFlag = 0;

/***************************************************************************
  * EventCache:
  *     A class representing an event cache with a fixed length that acts as a multiplexer and parse-cache-middleware for
  *     earthquake events and picks.
  * 
  * Constructor Inputs:
  *     maxEvents: number      // The maximum number of events that the cache can hold. Once the number of events exceeds this
  *                            // limit, the oldest events will be removed from the cache.
  * 
  * Properties:
  *     cache: Array          // An array representing the event cache with a fixed length (queue of events).
  *     maxLength: number     // The maximum number of events that the cache can hold.
  * 
  * Methods:
  *     push(event):          // Adds a new event to the cache. If the cache length exceeds the maxLength, the oldest event will
  *                            // be removed from the cache (FIFO behavior).
  *     newEvent(pattern, event, channel): 
  *                           // Adds a new extended event to the cache based on the channel type and emit "newEvent" JS event. 
  *                           // If the channel is 'SC_EVENT', it calls addPlacesAttribute to parse and add location info before pushing it 
  *                           // the event to the cache. 
  *                           // For 'SC_PICK', the event data is directly added without parsing.
  * 
  * Events:
  *     newEvent:             // This event is emitted when a new extended event is added to the cache. The extended event
  *                            // contains the following properties:
  *                            // - name: string (channel name)
  *                            // - id: number (int timestamp in milliseconds)
  *                            // - data: Object (event data containing earthquake details with added location information
  *                            //           for 'SC_EVENT' or direct event data for 'SC_PICK').
  * 
  * Note:
  *     - This class extends EventEmitter to enable event emission.
 ***************************************************************************/
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
      let updatedEvent = await EQEventsService.addPlacesAttribute([event]) // parse
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
const eventCache = new EventCache(30); // will contain last 30 EQevents added via new-event


/* --- External Event Sources --- */

/***************************************************************************
  * sseConnectionsEventListener:
  *     Subscribe to the ringserver's /sse-connections endpoint to listen for real-time SSE (Server-Sent Events) updates 
  *     about *socket* connection status.
  * 
  * Note:
  *     - This function establishes a connection to the ringserver's /sse-connections endpoint using the EventSource API.
  *     - The ringserver's IP address and port are obtained from environment variables (process.env.RINGSERVER_HOST and
  *       process.env.RINGSERVER_PORT).
  *     - The function listens for SSE events, specifically 'ringserver-connections-status', 'open', 'error', and 'close'.
  *     - When the 'ringserver-connections-status' event is received, the function extracts the connections data from the event,
  *       filters connections with the role 'sensor', and saves the current_time to the MongoDB for each sensor connection by
  *       updating the 'updatedAt' property of the corresponding user in the Users collection.
  *     - The function handles 'open' and 'close' events by logging messages to the console.
  *     - For 'error' events, the function keeps track of the number of errors (sseConnectionsErrorFlag) and logs error messages.
  *       If there are repeated errors (3 or more), it logs a specific message indicating that it will keep retrying the connection.
  * 
  * Caution:
  *     - This function should be called with care as it establishes a persistent connection to the ringserver's SSE endpoint.
  *       Frequent or unnecessary calls may lead to an excessive number of open connections.
 ***************************************************************************/
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

/***************************************************************************
  * sseStreamsEventListener:
  *     Subscribe to the ringserver's /sse-streams endpoint to listen for SSE (Server-Sent Events) updates
  *     about *device* (identified by a streamID) connection status.
  * 
  * Note:
  *     - This function establishes a connection to the ringserver's /sse-streams endpoint using the EventSource API.
  *     - The ringserver's IP address and port are obtained from environment variables (process.env.RINGSERVER_HOST and
  *       process.env.RINGSERVER_PORT).
  *     - The function listens for SSE events, specifically 'ringserver-streamids-status', 'open', 'error', and 'close'.
  *     - When the 'ringserver-streamids-status' event is received, the function processes the received stream IDs and their latest
  *       data end times to determine the activity status (active or inactive) of the corresponding devices. The function updates
  *       the activity status and activityToggleTime of the devices in the Devices collection based on the stream data.
  *     - The function handles 'open' and 'close' events by logging messages to the console.
  *     - For 'error' events, the function keeps track of the number of errors (sseStreamsErrorFlag) and logs error messages. If
  *       there are repeated errors (3 or more), it logs a specific message indicating that it will keep retrying the connection.
  * 
  * Caution:
  *     - This function should be called with care as it establishes a persistent connection to the ringserver's SSE endpoint.
  *       Frequent or unnecessary calls may lead to an excessive number of open connections.
  *     - It is recommended to use this function only when SSE updates about stream IDs and their latest data end times are required
  *       to determine the activity status of devices.
 ***************************************************************************/
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
