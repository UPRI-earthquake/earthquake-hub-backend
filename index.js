const express = require('express');
const redis = require("redis")
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 5000;

const stationsRouter = require('./routes/stations');
const eventsRouter = require('./routes/events');

app.use(cors({origin: 'http://localhost:3000'}))
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.json({'message': 'ok'});
})

// These are called once in webapp init
app.use('/stationLocations', stationsRouter)
app.use('/eventsList', eventsRouter)

/* Error handler middleware */
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  console.error(err.message, err.stack);
  res.status(statusCode).json({'message': err.message});

  return;
});

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`)
});

// Setup Redis pubsub subscriber, and Event Emitter
const redis_channel = "PICK"
const redis_host = "172.17.0.2"

const subscriber = redis.createClient({host:redis_host})
subscriber.on("message", (channel, message) => {
  console.log(JSON.parse(message));
});
subscriber.subscribe(redis_channel)

