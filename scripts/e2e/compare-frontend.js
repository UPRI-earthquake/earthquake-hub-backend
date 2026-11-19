// End-to-end check, frontend: compares what each page showed on a baseline run with a later run
// (e2e/frontend, Playwright; each saved under frontend/<run>): the visible text line by line, and which
// console errors and failed requests each showed. A page with the same lines in another order is
// reported apart, with the lines that moved (e.g. map overlays, listed in the order their static files
// happen to load). Screenshots are compared by eye in docs/e2e/E2E_RESULTS.md.
//
// The runs default to baseline (recorded with E2E_RECORD_AS=baseline) and postgres (a run as is).
// Writes frontend-compare.json to the output folder.
//
//   node scripts/e2e/compare-frontend.js [output folder] [--runs=<baseline run>,<run>]
const fs = require('fs');
const path = require('path');
const { DEFAULT_OUTPUT_DIR, positional } = require('./env');

const distinct = (list) => [...new Set(list)].sort();

const lineDiff = (a, b) => {
  const left = a.split('\n');
  const right = b.split('\n');
  const onlyBaseline = left.filter((line) => !right.includes(line));
  const onlyRun = right.filter((line) => !left.includes(line));
  return { onlyBaseline, onlyRun, sameOrder: a === b };
};

function compareFrontend(outputDir = DEFAULT_OUTPUT_DIR, [baselineRun, run] = ['baseline', 'postgres']) {
  const dir = (name) => path.join(outputDir, 'frontend', name);
  const pages = fs.readdirSync(dir(baselineRun)).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
  const report = pages.map((page) => {
    const read = (name) => {
      const file = path.join(dir(name), `${page}.json`);
      return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    };
    const b = read(baselineRun);
    const r = read(run);
    if (!r) return { page, same: false, missing: run };
    const text = lineDiff(b.text, r.text);
    // Which messages, not how many times: the requests the test blocks (map tiles and other outside
    // URLs, logged as "Failed to load resource: net::ERR_FAILED") vary in number with render timing
    const sameSet = (x, y) => JSON.stringify(distinct(x)) === JSON.stringify(distinct(y));
    const consoleSame = sameSet(b.consoleErrors, r.consoleErrors);
    const requestsSame = sameSet(b.failedRequests, r.failedRequests);
    const runLines = r.text.split('\n');
    return {
      page,
      same: text.sameOrder && consoleSame && requestsSame,
      sameContent: text.onlyBaseline.length === 0 && text.onlyRun.length === 0 && consoleSame && requestsSame,
      movedLines: text.sameOrder ? [] : b.text.split('\n').filter((line, i) => runLines[i] !== line),
      text,
      consoleErrors: { baseline: b.consoleErrors, run: r.consoleErrors, same: consoleSame },
      failedRequests: { baseline: b.failedRequests, run: r.failedRequests, same: requestsSame },
    };
  });
  fs.writeFileSync(path.join(outputDir, 'frontend-compare.json'), `${JSON.stringify(report, null, 2)}\n`);
  report.forEach((p) => {
    const detail = p.missing ? `no ${p.missing} run`
      : [
        !p.text.sameOrder && `text: ${p.text.onlyBaseline.length} line(s) only in the baseline, ${p.text.onlyRun.length} only in this run${p.text.onlyBaseline.length + p.text.onlyRun.length === 0 ? ' (order differs)' : ''}`,
        !p.consoleErrors.same && 'console errors differ',
        !p.failedRequests.same && 'failed requests differ',
      ].filter(Boolean).join('; ');
    const errors = p.consoleErrors ? distinct(p.consoleErrors.baseline).length + distinct(p.failedRequests.baseline).length : 0;
    const verdict = p.same ? 'same' : (p.sameContent ? 'same content, other order' : 'DIFF');
    const moved = p.sameContent && !p.same ? ` [moved: ${p.movedLines.join(', ')}]` : '';
    console.log(`${verdict} ${p.page}${p.same || p.sameContent ? moved : (detail ? `: ${detail}` : '')}${errors ? ` (${errors} distinct console error(s) or failed request(s), in both)` : ''}`);
  });
  return { ok: report.every((p) => p.same || p.sameContent), report };
}

module.exports = { compareFrontend };

if (require.main === module) {
  const [outputArg] = positional();
  const runsArg = process.argv.find((arg) => arg.startsWith('--runs='));
  const runs = runsArg ? runsArg.slice('--runs='.length).split(',') : undefined;
  if (runs && runs.length !== 2) throw new Error('--runs needs two runs: <baseline run>,<run>');
  const { ok } = compareFrontend(outputArg ? path.resolve(outputArg) : undefined, runs);
  process.exit(ok ? 0 : 1);
}
