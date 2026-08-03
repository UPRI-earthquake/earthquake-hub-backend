function positiveIntegerEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function defaultKeyGenerator(req) {
  return req.accountId || req.username || req.ip || req.headers['x-forwarded-for'] || 'anonymous';
}

function createInMemoryRateLimiter({
  windowMs = positiveIntegerEnv('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  max = positiveIntegerEnv('RATE_LIMIT_MAX', 100),
  keyGenerator = defaultKeyGenerator,
  message = 'Too many requests. Please try again later.',
  onLimit,
} = {}) {
  const buckets = new Map();

  return function inMemoryRateLimiter(req, res, next) {
    const now = Date.now();
    if (buckets.size > 1000) {
      for (const [bucketKey, bucket] of buckets.entries()) {
        if (bucket.resetAt <= now) {
          buckets.delete(bucketKey);
        }
      }
    }

    const key = String(keyGenerator(req) || 'anonymous');
    const currentBucket = buckets.get(key);

    if (!currentBucket || currentBucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    currentBucket.count += 1;
    if (currentBucket.count <= max) {
      next();
      return;
    }

    const rejectRequest = () => {
      res.set('Retry-After', String(Math.ceil((currentBucket.resetAt - now) / 1000)));
      res.status(429).json({
        status: 1,
        message,
      });
    };

    if (!onLimit) {
      rejectRequest();
      return;
    }

    Promise.resolve(onLimit(req, {
      count: currentBucket.count,
      key,
      max,
      resetAt: new Date(currentBucket.resetAt),
    }))
      .then(rejectRequest)
      .catch(next);
  };
}

module.exports = {
  createInMemoryRateLimiter,
  positiveIntegerEnv,
};
