const { createInMemoryRateLimiter, positiveIntegerEnv } = require('../src/middlewares/rateLimit.middleware');

function createMockResponse() {
  const res = {};
  res.set = jest.fn().mockReturnValue(res);
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('rateLimit.middleware', () => {
  test('allows requests until the configured limit is exceeded', () => {
    const limiter = createInMemoryRateLimiter({
      windowMs: 60000,
      max: 2,
      keyGenerator: () => 'same-user',
      message: 'Too many report submissions.',
    });
    const req = { ip: '127.0.0.1' };
    const firstRes = createMockResponse();
    const secondRes = createMockResponse();
    const thirdRes = createMockResponse();
    const firstNext = jest.fn();
    const secondNext = jest.fn();
    const thirdNext = jest.fn();

    limiter(req, firstRes, firstNext);
    limiter(req, secondRes, secondNext);
    limiter(req, thirdRes, thirdNext);

    expect(firstNext).toHaveBeenCalled();
    expect(secondNext).toHaveBeenCalled();
    expect(thirdNext).not.toHaveBeenCalled();
    expect(thirdRes.status).toHaveBeenCalledWith(429);
    expect(thirdRes.json).toHaveBeenCalledWith({
      status: 1,
      message: 'Too many report submissions.',
    });
  });

  test('positiveIntegerEnv falls back for invalid values', () => {
    const originalValue = process.env.TEST_RATE_LIMIT_VALUE;
    process.env.TEST_RATE_LIMIT_VALUE = 'not-a-number';

    expect(positiveIntegerEnv('TEST_RATE_LIMIT_VALUE', 10)).toBe(10);

    if (typeof originalValue === 'undefined') {
      delete process.env.TEST_RATE_LIMIT_VALUE;
    } else {
      process.env.TEST_RATE_LIMIT_VALUE = originalValue;
    }
  });
});
