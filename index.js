const fs = require('fs');
const https = require('https');
const express = require('express');
const redis = require("redis")
const bodyParser = require('body-parser');
const cors = require('cors');
const webpush = require('web-push')
const events = require('./services/events')
require('dotenv').config({path: __dirname + '/.env'})

const app = express();
const port = process.env.PORT || 5000;

const stationsRouter = require('./routes/stations');
const eventsRouter = require('./routes/events');
const messagingRouter = require('./routes/messaging');

app.use(cors({origin:'*'}))//{origin: 'http://localhost:3000'}))
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }));

// Setup Redis pubsub subscriber, and Event Emitter
const redis_channel = "SC_*" // SC_PICK or SC_EVENT
const redis_host = "172.17.0.2"
const subscriber = redis.createClient({host:redis_host})
subscriber.psubscribe(redis_channel)


// ROUTES
app.get('/', (req, res) => {
  res.json({'message': 'ok'});
})
app.use('/stationLocations', stationsRouter)
app.use('/eventsList', eventsRouter)
app.use('/messaging', messagingRouter)
webpush.setVapidDetails(
  process.env.WEB_PUSH_CONTACT,
  process.env.PUBLIC_VAPID_KEY,
  process.env.PRIVATE_VAPID_KEY,
)
var subscribers = []
app.post('/notifications/subscribe', (req,res) => {
  const subscription = req.body
  if(!subscribers.some(sub => sub.endpoint === subscription.endpoint)){
    subscribers.push(subscription)
  }
  console.log(subscribers)
  res.status(200).json({'success': true})
})

subscriber.on("pmessage", async (pattern, channel, message) => {
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

      subscribers.forEach(subscriber => {
        webpush.sendNotification(subscriber, payload)
          .catch(e => console.log(e.stack))
      })
    }
  }
});


/* Error handler middleware */
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  console.error(err.message, err.stack);
  res.status(statusCode).json({'message': err.message});

  return;
});

var privateKey = fs.readFileSync( './localhost+1-key.pem' );
var certificate = fs.readFileSync( './localhost+1.pem' );
https.createServer({
    key: privateKey,
    cert: certificate
}, app).listen(port, () => {
  console.log(`Example app listening at https://localhost:${port}`)
});


