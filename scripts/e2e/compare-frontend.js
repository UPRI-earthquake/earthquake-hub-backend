// End-to-end check, frontend: compares what each page showed on the MongoDB run with the PostgreSQL run
// (e2e/frontend, Playwright): the visible text line by line, and which console errors and failed
// requests each showed. A page with the same lines in another order is reported apart, with the lines that moved
// (e.g. map overlays, listed in the order their static files happen to load). Screenshots are compared
// by eye in docs/e2e/E2E_RESULTS.md.
//
// Writes frontend-compare.json to the output folder.
//
//   node scripts/e2e/compare-frontend.js [output folder]
const fs = require('fs');
const path = require('path');
const { DEFAULT_OUTPUT_DIR } = require('./env');

const distinct = (list) => [...new Set(list)].sort();

const lineDiff = (a, b) => {
  const left = a.split('\n');
  const right = b.split('\n');
  const onlyLeft = left.filter((line) => !right.includes(line));
  const onlyRight = right.filter((line) => !left.includes(line));
  return { onlyMongodb: onlyLeft, onlyPostgres: onlyRight, sameOrder: a === b };
};

function compareFrontend(outputDir = DEFAULT_OUTPUT_DIR) {
  const dir = (name) => path.join(outputDir, 'frontend', name);
  const pages = fs.readdirSync(dir('mongodb')).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
  const report = pages.map((page) => {
    const read = (name) => {
      const file = path.join(dir(name), `${page}.json`);
      return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    };
    const m = read('mongodb');
    const p = read('postgres');
    if (!p) return { page, same: false, missing: 'postgres' };
    const text = lineDiff(m.text, p.text);
    // Which messages, not how many times: the requests the test blocks (map tiles and other outside
    // URLs, logged as "Failed to load resource: net::ERR_FAILED") vary in number with render timing
    const sameSet = (a, b) => JSON.stringify(distinct(a)) === JSON.stringify(distinct(b));
    const consoleSame = sameSet(m.consoleErrors, p.consoleErrors);
    const requestsSame = sameSet(m.failedRequests, p.failedRequests);
    const pLines = p.text.split('\n');
    return {
      page,
      same: text.sameOrder && consoleSame && requestsSame,
      sameContent: text.onlyMongodb.length === 0 && text.onlyPostgres.length === 0 && consoleSame && requestsSame,
      movedLines: text.sameOrder ? [] : m.text.split('\n').filter((line, i) => pLines[i] !== line),
      text,
      consoleErrors: { mongodb: m.consoleErrors, postgres: p.consoleErrors, same: consoleSame },
      failedRequests: { mongodb: m.failedRequests, postgres: p.failedRequests, same: requestsSame },
    };
  });
  fs.writeFileSync(path.join(outputDir, 'frontend-compare.json'), `${JSON.stringify(report, null, 2)}\n`);
  report.forEach((r) => {
    const detail = r.missing ? `no ${r.missing} run`
      : [
        !r.text.sameOrder && `text: ${r.text.onlyMongodb.length} line(s) only on MongoDB, ${r.text.onlyPostgres.length} only on PostgreSQL${r.text.onlyMongodb.length + r.text.onlyPostgres.length === 0 ? ' (order differs)' : ''}`,
        !r.consoleErrors.same && 'console errors differ',
        !r.failedRequests.same && 'failed requests differ',
      ].filter(Boolean).join('; ');
    const errors = r.consoleErrors ? distinct(r.consoleErrors.mongodb).length + distinct(r.failedRequests.mongodb).length : 0;
    const verdict = r.same ? 'same' : (r.sameContent ? 'same content, other order' : 'DIFF');
    const moved = r.sameContent && !r.same ? ` [moved: ${r.movedLines.join(', ')}]` : '';
    console.log(`${verdict} ${r.page}${r.same || r.sameContent ? moved : (detail ? `: ${detail}` : '')}${errors ? ` (${errors} distinct console error(s) or failed request(s), on both)` : ''}`);
  });
  return { ok: report.every((r) => r.same || r.sameContent), report };
}

module.exports = { compareFrontend };

if (require.main === module) {
  const { ok } = compareFrontend(process.argv[2] ? path.resolve(process.argv[2]) : undefined);
  process.exit(ok ? 0 : 1);
}
