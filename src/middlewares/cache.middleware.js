/**
 * Simple Cache-Control middleware for safe GET endpoints.
 * Usage: router.get(path, cacheSeconds(60), handler)
 *
 * Notes:
 * - Keep lifetimes conservative for dynamic data.
 * - SSE endpoints and auth/device endpoints should not use this.
 */
function cacheSeconds(seconds = 60) {
  return function cacheControl(_req, res, next) {
    try {
      // public so proxies/CDNs may cache as well; tune in your reverse proxy if needed
      res.setHeader('Cache-Control', `public, max-age=${Number(seconds) || 0}`);
    } catch (_) {}
    next();
  };
}

module.exports = { cacheSeconds };

