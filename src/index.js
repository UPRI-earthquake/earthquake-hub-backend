const dns = require('dns');
const os = require('os');
const http = require('http');
const app = require('./app');
const MessagingService = require('./services/messaging.service');
const SubscriptionCleanupService = require('./services/subscriptionCleanup.service');
const logger = require('./middlewares/logger.middleware');

// cron setup
const { startEnrichmentScheduler } = require('./job/enrichment.job');

const port = process.env.NODE_ENV === 'production'
             ? process.env.BACKEND_PROD_PORT
             : process.env.BACKEND_DEV_PORT;

// Keep side-effectful services (DB, SSE listeners) here so tests can import app without them
const mongodb = require('./services/mongodb.service');
mongodb.connect(); // Required by notifs router

// start cron enrichment
startEnrichmentScheduler();

SubscriptionCleanupService.startSubscriptionCleanupScheduler();
console.log('mongodb-host: ' + process.env.MONGO_HOST);

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
