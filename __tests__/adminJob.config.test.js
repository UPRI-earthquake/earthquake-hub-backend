const {
  DEFAULT_ADMIN_JOB_MAX_ATTEMPTS,
  DEFAULT_ADMIN_JOB_RETENTION_DAYS,
  DEFAULT_ADMIN_JOB_TIMEOUT_MS,
  getAdminJobConfig,
  resolveAdminJobRetention,
} = require('../src/config/adminJob.config');

describe('admin job configuration', () => {
  const original = {};
  const names = ['ADMIN_JOB_MAX_ATTEMPTS', 'ADMIN_JOB_RETENTION_DAYS', 'ADMIN_JOB_TIMEOUT_MS'];

  beforeAll(() => names.forEach((name) => { original[name] = process.env[name]; }));
  afterEach(() => names.forEach((name) => { delete process.env[name]; }));
  afterAll(() => names.forEach((name) => {
    if (original[name] !== undefined) process.env[name] = original[name];
  }));

  it('uses bounded operational defaults', () => {
    expect(getAdminJobConfig()).toEqual({
      maxAttempts: DEFAULT_ADMIN_JOB_MAX_ATTEMPTS,
      retentionDays: DEFAULT_ADMIN_JOB_RETENTION_DAYS,
      timeoutMs: DEFAULT_ADMIN_JOB_TIMEOUT_MS,
    });
  });

  it('retains terminal history for the configured period', () => {
    process.env.ADMIN_JOB_RETENTION_DAYS = '30';
    const now = new Date('2026-07-31T00:00:00.000Z');
    const retention = resolveAdminJobRetention(now);

    expect(retention.retentionDays).toBe(30);
    expect(retention.expiresAt).toEqual(new Date('2026-08-30T00:00:00.000Z'));
  });

  it('rejects unsafe timeout and retry configuration', () => {
    process.env.ADMIN_JOB_TIMEOUT_MS = '500';
    expect(() => getAdminJobConfig()).toThrow(/ADMIN_JOB_TIMEOUT_MS/);
    delete process.env.ADMIN_JOB_TIMEOUT_MS;
    process.env.ADMIN_JOB_MAX_ATTEMPTS = '20';
    expect(() => getAdminJobConfig()).toThrow(/ADMIN_JOB_MAX_ATTEMPTS/);
  });
});
