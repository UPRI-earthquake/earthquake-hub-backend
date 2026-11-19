// End-to-end check: rebuilds the end-to-end database from a saved baseline (README.md).
//
//   1. Starts the throwaway PostgreSQL and mail catcher (e2e/docker-compose.yml).
//   2. Recreates the database and restores baseline/postgres.dump into it: the data as it was saved,
//      before any read or write ran.
//   3. Applies the migrations added since the dump was taken (knex migrate:latest).
//   4. Empties the mail catcher.
//   5. Checks every table's count against the one saved with the baseline (table-checks.json).
//
// Reads baseline/postgres.dump and table-checks.json from the output folder, and writes restore.log and
// restore-checks.json there. Exit code 0 when every count matches.
//
//   node scripts/e2e/restore-baseline.js [output folder]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { BACKEND_ROOT, DEFAULT_OUTPUT_DIR, DATABASE_ENV, MAILPIT_API, positional } = require('./env');
const { countTables } = require('./tables');

// Before Knex reads it: the end-to-end PostgreSQL, never dev
Object.assign(process.env, DATABASE_ENV);

async function restoreBaseline(outputDir = DEFAULT_OUTPUT_DIR) {
  const dumpFile = path.join(outputDir, 'baseline', 'postgres.dump');
  if (!fs.existsSync(dumpFile)) throw new Error(`No saved baseline at ${dumpFile}`);
  const log = [];
  const compose = path.join(BACKEND_ROOT, 'e2e', 'docker-compose.yml');
  const exec = (args, options = {}) => execFileSync('docker', ['compose', '-f', compose, 'exec', '-T', 'postgres', ...args], {
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 1024 * 1024 * 1024, ...options,
  });

  console.log('1. Starting PostgreSQL and the mail catcher');
  execFileSync('docker', ['compose', '-f', compose, 'up', '-d', '--wait'], { stdio: 'inherit' });

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
    fs.writeFileSync(path.join(outputDir, 'restore.log'), `${log.join('\n')}\n`);
    throw new Error('pg_restore failed: see restore.log');
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

  console.log('5. Checking every table against the baseline');
  const saved = new Map(JSON.parse(fs.readFileSync(path.join(outputDir, 'table-checks.json'), 'utf8')).counts
    .map((c) => [c.table, c.postgresql]));
  const counts = (await countTables(db))
    .filter((c) => saved.has(c.table))
    .map((c) => ({ table: c.table, baseline: saved.get(c.table), restored: c.postgresql, same: c.postgresql === saved.get(c.table) }));
  await db.destroy();
  const lines = counts.map((c) => `${c.same ? 'ok  ' : 'FAIL'} ${c.table}: baseline ${c.baseline}, restored ${c.restored}`);
  lines.forEach((line) => console.log(`   ${line}`));
  const ok = counts.length === saved.size && counts.every((c) => c.same);
  log.push(...lines);
  fs.writeFileSync(path.join(outputDir, 'restore-checks.json'), `${JSON.stringify({ counts, ok }, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, 'restore.log'), `${log.join('\n')}\n`);
  console.log(ok ? 'Database restored.' : 'Restored with count differences: see restore-checks.json.');
  return { ok, counts, applied };
}

module.exports = { restoreBaseline };

if (require.main === module) {
  const [outputArg] = positional();
  restoreBaseline(outputArg ? path.resolve(outputArg) : undefined)
    .then(({ ok }) => process.exit(ok ? 0 : 1))
    .catch((err) => {
      console.error(`restore-baseline failed: ${err.stack || err.message}`);
      process.exit(2);
    });
}
