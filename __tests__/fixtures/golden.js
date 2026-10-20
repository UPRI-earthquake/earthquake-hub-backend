// Golden files: recorded API responses (status, key headers, body) in __tests__/golden/. A test sends
// a request and compares the response with its recording, so a change in what the API returns, such
// as after moving an area from MongoDB to PostgreSQL, fails the test.
//
// Re-record only when a response is meant to change, then review the diff in the PR:
//   UPDATE_GOLDEN=1 npm run test:integration
const fs = require('fs');
const path = require('path');

const GOLDEN_DIR = path.join(__dirname, '..', 'golden');
const RECORDED_HEADERS = ['content-type', 'cache-control'];

const pickHeaders = (headers) => Object.fromEntries(
  RECORDED_HEADERS.filter((name) => headers[name] !== undefined).map((name) => [name, headers[name]]),
);

// `request` ({ method, path, body }) is stored with the recording so each file reads on its own
const expectGolden = (name, request, res) => {
  const file = path.join(GOLDEN_DIR, `${name}.json`);
  const actual = {
    request,
    response: { status: res.status, headers: pickHeaders(res.headers), body: res.body },
  };

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
