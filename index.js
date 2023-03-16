const dns = require('dns');
const os = require('os');
const fs = require('fs');
const https = require('https');
const http = require('http');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
require('dotenv').config({path: __dirname + '/.env'})
console.log('db-host: ' + process.env.DB_HOST)

const app = express();
const port = process.env.NODE_ENV === 'production'
             ? process.env.BACKEND_PROD_PORT
             : process.env.BACKEND_DEV_PORT;

const mongodb = require('./services/mongodb')
mongodb.connect(); // Required by notifs router
                   // TODO: await this before using notifs endpoint...

const stationsRouter = require('./routes/stations');
const eventsRouter = require('./routes/events');
const messaging = require('./routes/messaging');
const notifs  = require('./routes/notifications');

app.use(cors({origin : process.env.NODE_ENV === 'production'
  ? 'https://' + process.env.CLIENT_PROD_HOST
  : 'https://' + process.env.CLIENT_DEV_HOST +":"+ process.env.CLIENT_DEV_PORT
}))
console.log('Development client expected at '
  + 'https://' + process.env.CLIENT_DEV_HOST +":"+ process.env.CLIENT_DEV_PORT);
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }));

// ROUTES
app.get('/', (req, res) => {
  res.json({'version': '1.0'});
})
app.use('/stationLocations', stationsRouter)
app.use('/eventsList', eventsRouter)
app.use('/messaging', messaging.router)
// TODO: await the redisProxy calls...
// TODO: quit() the redisProxy calls...
messaging.redisProxy() // forwards events from redis into a JS event
app.use('/notifications', notifs.router)
notifs.redisProxy() // forwards events from redis to web-push

/* Error handler middleware */
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  //console.trace(`Express error handler captured the following...\n ${err}`);
  (process.env.NODE_ENV === 'production') // Provide different error response on prod and dev
  ? res.status(statusCode).json({"message": "Server error occured"}) // TODO: make a standard api message for error
  : res.status(statusCode).json({
    'status': "Express error handler caught an error",
    'err': err.stack,
    'note': 'This error will only appear on non-production env'});

  return;
});

// Run Server
if (process.env.NODE_ENVV === 'production'){
  // Run production http server, to be SSL proxied with NGINX
  http.createServer(app)
    .listen(port, () => {
      dns.lookup(os.hostname(), function (err, IP, fam) {
        console.log(
          'Production backend listening at '
        + `http://${IP}:${port}`);
      })
      console.log(
        'Accessible through nginx at '
      + `https://${process.env.BACKEND_PROD_HOST}`);
    });
}else{
  // Run https server (for local development)
  var privateKey = fs.readFileSync( process.env.HTTPS_PRIVATE_KEY );
  var cert = fs.readFileSync( process.env.HTTPS_CERT );
  https.createServer({key: privateKey, cert: cert}, app)
    .listen(port, () => {
      dns.lookup(os.hostname(), function (err, IP, fam) {
        console.log(
          'Development backend listening at '
        + `https://${IP}:${port}`);
      })
    });
}
