// End-to-end check: builds a new baseline database from the seeded test data (scripts/seed-dev-data.js),
// with no production data, for when no saved baseline is available.
//
//   1. Starts the throwaway PostgreSQL and mail catcher (e2e/docker-compose.yml).
//   2. Recreates the database, applies every migration, and seeds the test data: dev's 906 earthquakes,
//      the qa_ accounts and the made-up sensors.
//   3. Writes, to the output folder (it must not hold a baseline yet):
//        baseline/postgres.dump   a pg_dump of the seeded database, before any read or write
//        table-checks.json        every table's count, which restore-baseline.js checks
//        sample-accounts.json     the accounts the comparisons sign in as (the qa_ accounts)
//
// Then record what this backend answers (README.md, "Recording a baseline"): start-backend.js, then
// compare-api.js --record and compare-writes.js --record.
//
//   node scripts/e2e/seed-baseline.js [output folder]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { BACKEND_ROOT, DEFAULT_OUTPUT_DIR, DATABASE_ENV, positional } = require('./env');
const { countTables } = require('./tables');

// Before Knex reads it: the end-to-end PostgreSQL, never dev
Object.assign(process.env, DATABASE_ENV);

// The seeded accounts the comparisons sign in as, one per kind
const SAMPLE_ACCOUNTS = [
  { kind: 'citizen', username: 'qa_citizen_1' },
  { kind: 'sensorOwner', username: 'qa_sensor_owner' },
  { kind: 'brgy', username: 'qa_brgy' },
];

async function seedBaseline(outputDir = DEFAULT_OUTPUT_DIR) {
  const dumpFile = path.join(outputDir, 'baseline', 'postgres.dump');
  if (fs.existsSync(dumpFile)) throw new Error(`${dumpFile} already exists: use another output folder, or remove it first`);
  fs.mkdirSync(path.dirname(dumpFile), { recursive: true });
  const compose = path.join(BACKEND_ROOT, 'e2e', 'docker-compose.yml');
  const psql = (...sql) => execFileSync('docker', ['compose', '-f', compose, 'exec', '-T', 'postgres',
    'psql', '-U', DATABASE_ENV.PG_USER, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', ...sql.flatMap((s) => ['-c', s])], { stdio: 'pipe' });

  console.log('1. Starting PostgreSQL and the mail catcher');
  execFileSync('docker', ['compose', '-f', compose, 'up', '-d', '--wait'], { stdio: 'inherit' });

  console.log('2. Recreating the database, migrating and seeding it');
  psql(`DROP DATABASE IF EXISTS ${DATABASE_ENV.PG_DATABASE} WITH (FORCE)`, `CREATE DATABASE ${DATABASE_ENV.PG_DATABASE} OWNER ${DATABASE_ENV.PG_USER}`);
  const { db } = require('../../src/db/knex');
  await db.migrate.latest();
  const { seedDevData, QA_PASSWORD } = require('../seed-dev-data');
  await seedDevData({ db, log: (line) => console.log(`   ${line}`) });

  console.log('3. Saving the baseline database, its counts and the sample accounts');
  const counts = await countTables(db);
  fs.writeFileSync(path.join(outputDir, 'table-checks.json'), `${JSON.stringify({ counts }, null, 2)}\n`);
  const found = new Set((await db('accounts').whereIn('username', SAMPLE_ACCOUNTS.map((s) => s.username)).pluck('username')));
  const samples = { password: QA_PASSWORD, accounts: SAMPLE_ACCOUNTS.map((s) => ({ ...s, found: found.has(s.username) })) };
  fs.writeFileSync(path.join(outputDir, 'sample-accounts.json'), `${JSON.stringify(samples, null, 2)}\n`);
  await db.destroy();
  const dump = execFileSync('docker', ['compose', '-f', compose, 'exec', '-T', 'postgres', 'pg_dump',
    '-U', DATABASE_ENV.PG_USER, '-d', DATABASE_ENV.PG_DATABASE, '--format=custom'], { maxBuffer: 1024 * 1024 * 1024 });
  fs.writeFileSync(dumpFile, dump);
  counts.forEach((c) => console.log(`   ${c.table}: ${c.postgresql}`));
  console.log(`   baseline/postgres.dump (${Math.round(dump.length / 1024)} KB)`);
  return { counts, samples };
}

module.exports = { seedBaseline };

if (require.main === module) {
  const [outputArg] = positional();
  seedBaseline(outputArg ? path.resolve(outputArg) : undefined)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`seed-baseline failed: ${err.stack || err.message}`);
      process.exit(2);
    });
}
