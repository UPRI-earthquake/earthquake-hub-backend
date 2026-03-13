const MessagingService = require('../services/messaging.service')
const crypto = require('crypto');
const RshakeAlertCredentialsService = require('../services/rshakeAlertCredentials.service');

// create helper middleware so we can reuse server-sent events
const SSEFormatting= (req, res, next) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  const sendEventStreamData = (eventName, data, id) => {
    if(!res.finished){
      res.write(`event: ${eventName}\n`);
      res.write(`data: ${data}\n`);
      res.write(`id: ${id}\n`);
      res.write(`\n\n`);
    }
  }

  // we are attaching sendEventStreamData to res, so we can use it later
  Object.assign(res, {
    sendEventStreamData
  });

  next();
}

const missedEventsResender = (req, res, next) => {
  var lastEventId = Number(req.headers['last-event-id'])
                    || Number(req.query.lastEventId)
  if(lastEventId){
    console.log('last-event-id:', lastEventId)
    const eventsToReSend = MessagingService.eventCache.cache.filter(e => e.id > lastEventId)

    eventsToReSend.forEach(event => {
      res.sendEventStreamData(
        event.name, JSON.stringify(event.data), event.id
      )
    })
  }
  next();
}

function secretsMatch(provided, expected) {
  const providedBuffer = Buffer.from(String(provided || ''), 'utf8');
  const expectedBuffer = Buffer.from(String(expected || ''), 'utf8');
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

const requireRshakeAlertSecret = async (req, res, next) => {
  const expectedSecret = String(process.env.RSHAKE_ALERT_SHARED_SECRET || '').trim();
  const providedSecret = String(req.get('X-RShake-Alert-Secret') || '').trim();

  if (expectedSecret && secretsMatch(providedSecret, expectedSecret)) {
    return next();
  }

  try {
    const deviceSecretResult = await RshakeAlertCredentialsService.verifyDeviceAlertCredential({
      providedSecret,
      device: req.body?.device,
    });

    if (deviceSecretResult?.matched) {
      return next();
    }

    if (!expectedSecret && !deviceSecretResult?.required) {
      return next();
    }
  } catch (error) {
    return next(error);
  }

  res.message = 'Rejected sender alert request (shared secret mismatch)';
  return res.status(403).json({
    status: 403,
    message: 'Forbidden',
  });
}

module.exports = {
  SSEFormatting,
  missedEventsResender,
  requireRshakeAlertSecret,
}
