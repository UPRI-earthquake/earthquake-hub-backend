// End-to-end check, re-run after Part 4: rebuilds the PostgreSQL-only environment from the saved
// baseline, with no MongoDB and no copy scripts (README.md, "Re-run after Part 4").
//
//   1. Starts the throwaway PostgreSQL and mail catcher (e2e/docker-compose.yml), not MongoDB.
//   2. Recreates the database and restores baseline/postgres.dump into it: the data right after the
//      first run's copy, before any read or write ran.
//   3. Applies the migrations added since the dump was taken (knex migrate:latest).
//   4. Empties the mail catcher.
//   5. Checks every table's count against the first run's (table-checks.json, "postgresql").
//
// Reads the first run's output folder (baseline/postgres.dump, table-checks.json) and writes to its
// rerun/ folder: restore.log and table-checks.json. Exit code 0 when every count matches.
//
//   node scripts/e2e/restore-baseline.js [output folder]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { BACKEND_ROOT, DEFAULT_OUTPUT_DIR, DATABASE_ENV, MAILPIT_API } = require('./env');

// Before Knex reads it: the end-to-end PostgreSQL, never dev
Object.assign(process.env, DATABASE_ENV);

// The first run's table labels (table-checks.js) and the tables they count
const TABLES = {
  accounts: 'accounts',
  devices: 'devices',
  'device releases': 'device_releases',
  'brgy forwarding': 'brgy_forwarded_devices',
  events: 'events',
  'event stations': 'event_stations',
  'event catalog matches': 'event_catalog_matches',
  'event catalog status': 'event_catalog_status',
  comments: 'comments',
  'helpful marks': 'comment_helpful_marks',
  'issue reports': 'comment_issue_reports',
  'contribution points': 'contribution_events',
};

async function restoreBaseline(outputDir = DEFAULT_OUTPUT_DIR) {
  const dumpFile = path.join(outputDir, 'baseline', 'postgres.dump');
  if (!fs.existsSync(dumpFile)) throw new Error(`No saved baseline at ${dumpFile}`);
  const rerunDir = path.join(outputDir, 'rerun');
  fs.mkdirSync(rerunDir, { recursive: true });
  const log = [];
  const compose = path.join(BACKEND_ROOT, 'e2e', 'docker-compose.yml');
  const exec = (args, options = {}) => execFileSync('docker', ['compose', '-f', compose, 'exec', '-T', 'postgres', ...args], {
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 1024 * 1024 * 1024, ...options,
  });

  console.log('1. Starting PostgreSQL and the mail catcher (no MongoDB)');
  execFileSync('docker', ['compose', '-f', compose, 'up', '-d', '--wait', 'postgres', 'mailpit'], { stdio: 'inherit' });

  console.log('2. Restoring baseline/postgres.dump');
  exec(['psql', '-U', DATABASE_ENV.PG_USER, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1',
    '-c', `DROP DATABASE IF EXISTS ${DATABASE_ENV.PG_DATABASE} WITH (FORCE)`,
    '-c', `CREATE DATABASE ${DATABASE_ENV.PG_DATABASE} OWNER ${DATABASE_ENV.PG_USER}`]);
  const dump = fs.readFileSync(dumpFile);
  let restoreOutput;
  try {
    restoreOutput = exec(['pg_restore', '-U', DATABASE_ENV.PG_USER, '-d', DATABASE_ENV.PG_DATABASE, '--no-owner', '--exit-on-error'], { input: dump });
  } catch (err) {
    log.push(`pg_restore failed (exit ${err.status}):`, String(err.stderr || err.message));
    fs.writeFileSync(path.join(rerunDir, 'restore.log'), `${log.join('\n')}\n`);
    throw new Error('pg_restore failed: see rerun/restore.log');
  }
  log.push(`pg_restore: ${Math.round(dump.length / 1024)} KB restored${restoreOutput.trim() ? `\n${restoreOutput.trim()}` : ''}`);
  console.log(`   ${Math.round(dump.length / 1024)} KB restored`);

  console.log('3. Applying the migrations added since the dump');
  const { db } = require('../../src/db/knex');
  const [, applied] = await db.migrate.latest();
  log.push(`migrations applied since the dump: ${applied.length ? applied.join(', ') : 'none'}`);
  console.log(`   ${applied.length ? applied.join(', ') : 'none'}`);

  console.log('4. Emptying the mail catcher');
  await fetch(`${MAILPIT_API}/messages`, { method: 'DELETE' });

  console.log('5. Checking every table against the first run');
  const first = JSON.parse(fs.readFileSync(path.join(outputDir, 'table-checks.json'), 'utf8'));
  const counts = [];
  for (const row of first.counts) {
    const table = TABLES[row.table];
    const postgresql = Number((await db(table).count({ n: '*' }).first()).n);
    counts.push({ table: row.table, firstRun: row.postgresql, rerun: postgresql, same: postgresql === row.postgresql });
  }
  counts.forEach((c) => console.log(`   ${c.same ? 'ok  ' : 'FAIL'} ${c.table}: first run ${c.firstRun}, re-run ${c.rerun}`));
  const ok = counts.every((c) => c.same);
  log.push(...counts.map((c) => `${c.same ? 'ok  ' : 'FAIL'} ${c.table}: first run ${c.firstRun}, re-run ${c.rerun}`));
  fs.writeFileSync(path.join(rerunDir, 'table-checks.json'), `${JSON.stringify({ counts, ok }, null, 2)}\n`);
  fs.writeFileSync(path.join(rerunDir, 'restore.log'), `${log.join('\n')}\n`);
  await db.destroy();
  console.log(ok ? 'PostgreSQL-only environment ready.' : 'Restore finished with count differences: see rerun/table-checks.json.');
  return { ok, counts, applied };
}

module.exports = { restoreBaseline };

if (require.main === module) {
  restoreBaseline(process.argv[2] ? path.resolve(process.argv[2]) : undefined)
    .then(({ ok }) => process.exit(ok ? 0 : 1))
    .catch((err) => {
      console.error(`restore-baseline failed: ${err.stack || err.message}`);
      process.exit(2);
    });
}
