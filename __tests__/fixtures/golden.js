// Golden files: recorded API responses (status, key headers, body) in __tests__/golden/. A test sends
// a request and compares the response with its recording, so a change in what the API returns, such
// as after moving an area from MongoDB to PostgreSQL, fails the test.
//
// Values that differ on every run are made stable before comparing:
//   - JWTs (in the body or in Set-Cookie) are replaced by their decoded claims, so the recording still
//     pins what a token says (username, role, accountId); iat becomes "<now>", exp "<now + Ns>" and a
//     random jti "<random>"
//   - timestamps from the current run (ISO or HTTP-date, within RECENT_MS of now) become "<now>";
//     seeded test data uses fixed past dates, which stay as they are. A cookie's future Expires
//     (now + Max-Age) becomes "<now + Max-Age>"
//   - values under SECRET_KEYS (random secrets) become "<secret>", and token expiry times in epoch
//     seconds under EXPIRY_KEYS become "<token expiry>"
//   - anything passed in `replace` (e.g. an id the request generated) becomes its placeholder
// (The clock isn't frozen instead: a frozen Date stalls MongoDB transactions.)
//
// Re-record only when a response is meant to change, then review the diff in the PR:
//   UPDATE_GOLDEN=1 npm run test:integration
const fs = require('fs');
const path = require('path');

const GOLDEN_DIR = path.join(__dirname, '..', 'golden');
const RECORDED_HEADERS = ['content-type', 'cache-control', 'set-cookie'];
const SECRET_KEYS = new Set(['sharedSecret']);
const EXPIRY_KEYS = new Set(['tokenExp']);
const RECENT_MS = 10 * 60 * 1000;
const JWT = /eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g;
const ISO_DATE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;
const HTTP_DATE = /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT/g;

const isRecent = (ms) => Math.abs(ms - Date.now()) <= RECENT_MS;

const jwtClaims = (token, replacements) => {
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  if (Number.isFinite(claims.iat) && Number.isFinite(claims.exp)) claims.exp = `<now + ${claims.exp - claims.iat}s>`;
  if (Number.isFinite(claims.iat) && isRecent(claims.iat * 1000)) claims.iat = '<now>';
  if (claims.jti) claims.jti = '<random>';
  Object.keys(claims).forEach((key) => {
    if (replacements.has(claims[key])) claims[key] = replacements.get(claims[key]);
  });
  return claims;
};

const stabilizeText = (text, replacements) => {
  let out = text;
  replacements.forEach((placeholder, literal) => { out = out.split(literal).join(placeholder); });
  return out
    .replace(new RegExp(`Expires=(${HTTP_DATE.source})`, 'g'), (match, date) => (
      Date.parse(date) > Date.now() - RECENT_MS ? 'Expires=<now + Max-Age>' : match))
    .replace(JWT, (token) => `<jwt ${JSON.stringify(jwtClaims(token, replacements))}>`)
    .replace(ISO_DATE, (date) => (isRecent(Date.parse(date)) ? '<now>' : date))
    .replace(HTTP_DATE, (date) => (isRecent(Date.parse(date)) ? '<now>' : date));
};

const stabilize = (value, replacements, key = null) => {
  if (Array.isArray(value)) return value.map((item) => stabilize(item, replacements));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stabilize(v, replacements, k)]));
  }
  if (key && EXPIRY_KEYS.has(key) && Number.isFinite(value)) return '<token expiry>';
  if (typeof value !== 'string') return value;
  if (key && SECRET_KEYS.has(key)) return '<secret>';
  if (replacements.has(value)) return replacements.get(value);
  // A whole-string JWT becomes its claims; one inside a longer string (a cookie) is inlined as text
  if (new RegExp(`^${JWT.source}$`).test(value)) return { jwt: jwtClaims(value, replacements) };
  return stabilizeText(value, replacements);
};

const pickHeaders = (headers) => Object.fromEntries(
  RECORDED_HEADERS.filter((name) => headers[name] !== undefined).map((name) => [name, headers[name]]),
);

// `request` ({ method, path, body }) is stored with the recording so each file reads on its own.
// options.replace: { [value]: placeholder } for values the request generated (new ids, ...)
const expectGolden = (name, request, res, { replace = {} } = {}) => {
  const file = path.join(GOLDEN_DIR, `${name}.json`);
  const replacements = new Map(Object.entries(replace));
  const actual = stabilize({
    request,
    response: { status: res.status, headers: pickHeaders(res.headers), body: res.body },
  }, replacements);

  if (process.env.UPDATE_GOLDEN === '1') {
    fs.mkdirSync(GOLDEN_DIR, { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(actual, null, 2)}\n`);
    return;
  }

  if (!fs.existsSync(file)) {
    throw new Error(`No golden file ${path.relative(process.cwd(), file)}. Record it with UPDATE_GOLDEN=1.`);
  }
  expect(actual).toEqual(JSON.parse(fs.readFileSync(file, 'utf8')));
};

module.exports = { expectGolden };
