const fs = require('fs');
const http = require('http');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
require('dotenv').config({path: __dirname + '/.env'})

const app = express();
const port = process.env.NODE_ENV === 'production'
             ? process.env.BACKEND_PROD_PORT
             : process.env.BACKEND_DEV_PORT;

const stationsRouter = require('./routes/stations');
const eventsRouter = require('./routes/events');
const messagingRouter = require('./routes/messaging');
const notifs  = require('./routes/notifications');

app.use(cors({origin : process.env.NODE_ENV === 'production'
  ? 'https://' + process.env.CLIENT_PROD_HOST
  : 'https://' + process.env.CLIENT_DEV_HOST +":"+ process.env.CLIENT_DEV_PORT
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
http.createServer(app).listen(port, () => {
  if (process.env.NODE_ENV === 'production'){
    console.log(
      'Production backend listening at '
    + `http://backend:${port}`)
    console.log(
      'Accessible through nginx at '
    + `https://${process.env.BACKEND_PROD_HOST}`
    )
  }else{
    console.log(
      'Development backend listening at '
    + `http://${process.env.BACKEND_DEV_HOST}:${port}`
    )
  }
});


