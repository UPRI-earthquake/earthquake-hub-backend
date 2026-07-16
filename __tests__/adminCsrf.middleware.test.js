const {
  requireAdminCsrf,
  requireAdminCsrfWhenAdmin,
} = require('../src/middlewares/adminCsrf.middleware');

function responseRecorder() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

describe('admin CSRF middleware', () => {
  it('rejects an administrator mutation without the matching cookie, header, and signed claim', () => {
    const req = { role: 'admin', cookies: { csrfToken: 'expected' }, csrfToken: 'expected', get: jest.fn(() => '') };
    const res = responseRecorder();
    const next = jest.fn();

    requireAdminCsrf(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows an administrator mutation only when all CSRF values match', () => {
    const req = { role: 'admin', cookies: { csrfToken: 'expected' }, csrfToken: 'expected', get: jest.fn(() => 'expected') };
    const res = responseRecorder();
    const next = jest.fn();

    requireAdminCsrfWhenAdmin(req, res, next);

    expect(res.statusCode).toBeNull();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('preserves the existing citizen flow on shared legacy routes', () => {
    const req = { role: 'citizen', cookies: {}, get: jest.fn(() => '') };
    const res = responseRecorder();
    const next = jest.fn();

    requireAdminCsrfWhenAdmin(req, res, next);

    expect(res.statusCode).toBeNull();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
