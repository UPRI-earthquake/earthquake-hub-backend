const fs = require('fs');
const https = require('https');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
require('dotenv').config({path: __dirname + '/.env'})

const app = express();
const port = process.env.PORT || 5000;

const stationsRouter = require('./routes/stations');
const eventsRouter = require('./routes/events');
const messagingRouter = require('./routes/messaging');
const notifs  = require('./routes/notifications');

app.use(cors({origin : process.env.NODE_ENV === 'production' 
              ? process.env.DOMAIN_HOST
              : ['https://localhost:3000', 'https://192.168.1.12:3000']
}))
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }));

// ROUTES
app.get('/', (req, res) => {
  res.json({'version': '1.0'});
})
app.use('/stationLocations', stationsRouter)
app.use('/eventsList', eventsRouter)
app.use('/messaging', messagingRouter)
app.use('/notifications', notifs.router)
notifs.proxy(); // forwards events from redis to web-push

/* Error handler middleware */
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  console.error(err.message, err.stack);
  (process.env.NODE_ENV === 'production')
  ? res.status(statusCode)
  : res.status(statusCode).json({'message': err.message});

  return;
});

// Run server
var privateKey = fs.readFileSync( './localhost+1-key.pem' );
var certificate = fs.readFileSync( './localhost+1.pem' );
https.createServer({
    key: privateKey,
    cert: certificate
}, app).listen(port, () => {
  console.log(`Example app listening at https://localhost:${port}`)
});


