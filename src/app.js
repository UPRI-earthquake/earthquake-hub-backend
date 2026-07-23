const express = require('express');
const compression = require('compression');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const swaggerJsDoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const fs = require('fs');
const { getUploadConfig } = require('./config/upload.config');
const gaMiddleware = require('./middlewares/ga.middleware');
const { responseCodes } = require('./controllers/responseCodes');
const { formatErrorMessage } = require('./controllers/helpers');
const logger = require('./middlewares/logger.middleware');


const app = express();
const {
  uploadDir,
  publicUploadPath,
  legacyPublicUploadPath,
} = getUploadConfig();

function getTrustProxySetting() {
  const configured = String(process.env.TRUST_PROXY || '').trim();
  if (!configured) return false;
  if (configured === 'true') return true;
  if (configured === 'false') return false;
  if (/^\d+$/.test(configured)) return Number(configured);

  const subnets = configured.split(',').map((value) => value.trim()).filter(Boolean);
  return subnets.length === 1 ? subnets[0] : subnets;
}

app.set('trust proxy', getTrustProxySetting());
app.disable('x-powered-by');

// Serve files from a directory named 'public'
app.use(express.static('public'));
app.use(publicUploadPath, express.static(uploadDir));

if (legacyPublicUploadPath !== publicUploadPath) {
  app.use(legacyPublicUploadPath, express.static(uploadDir));
}

// Compression: skip for SSE
app.use(
  compression({
    filter: (req, res) => {
      const type = res.getHeader('Content-Type');
      if (type && String(type).includes('text/event-stream')) return false;
      // fallback to standard filter
      // eslint-disable-next-line global-require
      return require('compression').filter(req, res);
    },
  }),
);

// Only serve Swagger in non-production and non-test to avoid I/O during tests
if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
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
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
    apis: ['./src/routes/*.js', './src/models/*.js'],
    failOnErrors: true,
  };
  const specs = swaggerJsDoc(options);
  try {
    const swaggerJson = JSON.stringify(specs, null, 2);
    fs.writeFileSync('./docs/ehub-backend-api-docs.json', swaggerJson, 'utf8');
  } catch (_) {}
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));
}

// CORS
const W1_host = process.env.NODE_ENV === 'production'
  ? 'https://' + process.env.CLIENT_PROD_HOST
  : 'http://' + process.env.CLIENT_DEV_HOST + ':' + process.env.CLIENT_DEV_PORT;
const W3_host = process.env.NODE_ENV === 'production'
  ? 'http://' + process.env.W3_CLIENT_PROD_HOST
  : 'http://' + process.env.W3_CLIENT_DEV_HOST;
const allowedOrigins = [W1_host, W3_host];
app.use(cors({ origin: allowedOrigins, credentials: true }));

// Parsers
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

// Google Analytics Measurement Protocol: API request tracking (conditionally enabled)
app.use(gaMiddleware());

// Request logging
app.use((req, _, next) => {
  logger.info(`${req.method} request to ${req.path}`, { label: 'requests', ip: req.ip });
  next();
});

// Response time logging
app.use((req, res, next) => {
  const startTime = performance.now();
  res.on('finish', () => {
    const endTime = performance.now();
    const processingTime = endTime - startTime;
    if (res.message) {
      logger.info(`Response sent after ${processingTime.toFixed(0)} ms: ${res.message}`, {
        label: 'responses',
        ip: req.ip,
      });
    }
  });
  next();
});

// Routes
app.get('/', (req, res) => {
  res.json({ version: '1.0' });
});
app.use('/accounts', require('./routes/accounts.route'));
app.use('/admin', require('./routes/admin.route'));
app.use('/admin/overview', require('./routes/adminOverview.route'));
app.use('/admin/audit-logs', require('./routes/auditLog.route'));
app.use('/admin/community-reports', require('./routes/adminCommunityReports.route'));
app.use('/admin/earthquake-events', require('./routes/adminEarthquakeEvents.route'));
app.use('/admin/devices-stations', require('./routes/adminDevicesStations.route'));
app.use('/admin/accounts', require('./routes/adminAccounts.route'));
app.use('/admin/ringserver', require('./routes/adminRingserver.route'));
app.use('/admin/seiscomp', require('./routes/adminSeiscomp.route'));
app.use('/admin/archive-storage', require('./routes/adminArchiveStorage.route'));
app.use('/admin/inventory-import', require('./routes/adminInventoryImport.route'));
app.use('/admin/deployment-health', require('./routes/adminDeploymentHealth.route'));
app.use('/admin/configuration-diagnostics', require('./routes/adminConfigurationDiagnostics.route'));
app.use('/admin/system', require('./routes/adminSystem.route'));
app.use('/admin/search', require('./routes/adminGlobalSearch.route'));
app.use('/device', require('./routes/devices.route'));
app.use('/messaging', require('./routes/messaging.route'));
app.use('/notifications', require('./routes/notifications.route'));
app.use('/eq-events', require('./routes/EQevents.route'));
app.use('/significant-eqs', require('./routes/significantEQs.route'));
app.use('/overlays', require('./routes/overlays.route'));
app.use('/comments', require('./routes/comments.route'));

function getValidationErrorMessages(err) {
  if (Array.isArray(err.details)) {
    return err.details.map((detail) => formatErrorMessage(detail.message));
  }

  if (err.errors && typeof err.errors === 'object') {
    return Object.values(err.errors).map((error) => formatErrorMessage(error.message));
  }

  return [formatErrorMessage(err.message || 'Validation error')];
}

/* Error handler middleware */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.name === 'ValidationError') {
    const errorMessages = getValidationErrorMessages(err);
    res.status(400).json({ status: responseCodes.VALIDATION_ERROR, message: errorMessages[0] });
    res.message = errorMessages; // used by res.on('finish') logger middleware
  } else {
    const statusCode = err.statusCode || 500;
    if (process.env.NODE_ENV === 'production') {
      res.status(statusCode).json({ status: responseCodes.GENERIC_ERROR, message: 'Server error occurred' });
    } else {
      res.status(statusCode).json({
        status: responseCodes.GENERIC_ERROR,
        err: err.stack,
        note: 'This error will only appear on non-production env. In production message is: Server error occurred',
      });
    }
    logger.error(`Server error occurred: \n\t${err.stack}`, { label: 'internalErrors', ip: req.ip });
  }
});

module.exports = app;
