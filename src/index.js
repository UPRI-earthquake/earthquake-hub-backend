const dns = require('dns');
const os = require('os');
const http = require('http');
const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const swaggerJsDoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const fs = require('fs');

const {responseCodes} = require('./controllers/responseCodes');
const MessagingService = require('./services/messaging.service');
const logger = require('./middlewares/logger.middleware');


const app = express();

if(process.env.NODE_ENV !== 'production'){
  const options = {
    swaggerDefinition: {
      openapi: '3.0.0',
      info: {
        title: 'UPRI EarthquakeHub APIs',
        version: '1.0.0',
        description: 'These are the API endpoints used for UPRI earthquake-hub-backend',
      },
      components: {
        securitySchemes: {
          bearerAuth: { //arbitrary name for the security scheme; will be used in the "security" key later
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        }
      },
    },
    apis: ['./src/routes/*.js', './src/models/*.js'], // Path to the API routes and models in your project
    failOnErrors: true,
  };
  const specs = swaggerJsDoc(options);
  const swaggerJson = JSON.stringify(specs, null, 2); // Convert to JSON with 2 spaces as indent
  fs.writeFileSync('./docs/ehub-backend-api-docs.json', swaggerJson, 'utf8'); // Write the JSON data to a file (e.g., api-docs.json)
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));
}

const port = process.env.NODE_ENV === 'production'
             ? process.env.BACKEND_PROD_PORT
             : process.env.BACKEND_DEV_PORT;

const mongodb = require('./services/mongodb.service')
mongodb.connect(); // Required by notifs router
                   // TODO: await this before using notifs endpoint...
console.log('mongodb-host: ' + process.env.MONGO_HOST)


app.use(cors({origin : process.env.NODE_ENV === 'production'
  ? 'https://' + process.env.CLIENT_PROD_HOST
  : 'http://' + process.env.CLIENT_DEV_HOST +":"+ process.env.CLIENT_DEV_PORT,
  credentials: true
}))
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

// ROUTES
app.use((req, _, next) => { // request logger middleware
  logger.info(`${req.method} request to ${req.path}`, {
    label: 'requests',
    ip: req.ip,
  })
  next()
})

app.get('/', (req, res) => {
  res.json({'version': '1.0'});
})
app.use('/accounts', require('./routes/accounts.route'))
app.use('/device', require('./routes/devices.route'))
app.use('/messaging', require('./routes/messaging.route'))
app.use('/notifications', require('./routes/notifications.route'))
app.use('/eq-events', require('./routes/EQevents.route'))

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

  if (process.env.NODE_ENV === 'production') { // Provide different error response on prod and dev
    res.status(statusCode).json({
      'status': responseCodes.GENERIC_ERROR,
      "message": "Server error occured"
    })
  }else{
    res.status(statusCode).json({
    'status': responseCodes.GENERIC_ERROR,
    'err': err.stack,
    'note': 'This error will only appear on non-production env'
    });
  }

  logger.error(`Server error occured: ${err.stack}`, {
    label: 'internalErrors',
    ip: req.ip,
  })

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
  MessagingService.sseConnectionsEventListener() // listen for ringserver-connections-status events from ringserver
  MessagingService.sseStreamsEventListener() // listen for ringserver-streamids-status events from ringserver
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
  MessagingService.sseConnectionsEventListener() // listen for ringserver-connections-status events from ringserver
  MessagingService.sseStreamsEventListener() // listen for ringserver-streamids-status events from ringserver
}
