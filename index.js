const dns = require('dns');
const os = require('os');
const http = require('http');
const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const cors = require('cors');

console.log('db-host: ' + process.env.MONGO_HOST)
require('./models/index');

console.log('mysql-host: ' + process.env.MYSQL_HOST)

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

const {
  responseCodes,
  responseMessages
} = require('./routes/responseCodes')

app.use(cors({origin : process.env.NODE_ENV === 'production'
  ? 'https://' + process.env.CLIENT_PROD_HOST
  : 'http://' + process.env.CLIENT_DEV_HOST +":"+ process.env.CLIENT_DEV_PORT,
  credentials: true
}))
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

// ROUTES
app.get('/', (req, res) => {
  res.json({'version': '1.0'});
})
app.use('/stationLocations', stationsRouter)
app.use('/eventsList', eventsRouter)
app.use('/messaging', messaging.router)
messaging.sseConnectionsEventListener() // listen for ringserver-connections-status events from ringserver
messaging.sseStreamsEventListener() // listen for ringserver-streamids-status events from ringserver
// TODO: await the redisProxy calls...
// TODO: quit() the redisProxy calls...
app.use('/notifications', notifs.router)
notifs.redisProxy() // forwards events from redis to web-push
app.use('/accounts', require('./routes/accounts.route'))
app.use('/device', require('./routes/devices.route'))

// TODO: Test for multiple origin 
// app.use((req, res, next) => {
//   res.header(
//     "Access-Control-Allow-Headers",
//     "Origin, Content-Type, Accept"
//   );
//   next();
// });

/* Error handler middleware */
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  //console.trace(`Express error handler captured the following...\n ${err}`);
  if (process.env.NODE_ENV === 'production') { // Provide different error response on prod and dev
    res.status(statusCode).json({
      'status': responseCodes.GENERIC_ERROR,
      "message": "Server error occured"
    })
    console.log('Server error occured:', err.stack)
  }else{
    res.status(statusCode).json({
    'status': responseCodes.GENERIC_ERROR,
    'err': err.stack,
    'note': 'This error will only appear on non-production env'
    });
    console.log('Server error occured:', err.stack)
  }

  return;
});

// Run Server
if (process.env.NODE_ENV === 'production'){
  // Run production http server, to be SSL proxied with NGINX
  http.createServer(app)
    .listen(port, () => {
      console.log(
        'Accessible through nginx at '
      + `https://${process.env.BACKEND_PROD_HOST}`);
      dns.lookup(os.hostname(), function (err, IP, fam) {
        console.log(
          'Production backend listening at '
        + `http://${IP}:${port}`);
      });
      console.log(
        'Production client expected (by CORS) at '
      + `https://${process.env.CLIENT_PROD_HOST}`);
    });
}else{
  // Run http server (for local development)
  http.createServer(app)
    .listen(port, () => {
      dns.lookup(os.hostname(), function (err, IP, fam) {
        console.log(
          'Development backend listening at '
        + `http://${IP}:${port}`);
      console.log(
        'Development client expected (by CORS) at '
      + `http://${process.env.CLIENT_DEV_HOST}:${process.env.CLIENT_DEV_PORT}`);
      })
    });
}
