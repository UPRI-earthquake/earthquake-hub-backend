// End-to-end check: builds the environment from a production export, from scratch, in one run.
//
//   1. Starts the throwaway MongoDB, PostgreSQL and mail catcher (e2e/docker-compose.yml).
//   2. Migrates PostgreSQL and empties every table.
//   3. Imports the export into MongoDB (import-prod-json.js), then runs this branch's MongoDB migrations
//      (scripts/migrate-*.js), as deploying the branch on MongoDB would: e.g. migrate-event-indexes
//      backfills the GeoJSON location on events and devices, which production's data predates. The
//      MongoDB side of the comparison is this branch on MongoDB, as PostgreSQL's is this branch on
//      PostgreSQL.
//   4. Copies it to PostgreSQL with the real copy scripts, in order: accounts and devices, earthquakes,
//      comments and points.
//   5. Checks every table and link (table-checks.js).
//   6. Saves the baseline: a pg_dump of PostgreSQL right after the copy (baseline/postgres.dump), so the
//      re-run after Part 4, when the copy scripts are gone, can restore the same data.
//
// Reports go to the output folder, outside the repos (they hold production data):
// import-report.json, mongo-migrate-*.log, copy-*.log, table-checks.json. Exit code 0 when every copy validated and every
// check passed.
//
//   node scripts/e2e/setup.js [export folder] [output folder]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { BACKEND_ROOT, DEFAULT_EXPORT_DIR, DEFAULT_OUTPUT_DIR, DATABASE_ENV, MAIL_ENV, e2eEnv } = require('./env');

// This branch's MongoDB migrations, in the order they were added
const MONGO_MIGRATIONS = ['migrate-unique-indexes', 'migrate-event-indexes', 'migrate-catalog-info-to-array'];

// Before anything reads them: the copy scripts, Knex and Mongoose use these, never the dev databases
Object.assign(process.env, DATABASE_ENV, MAIL_ENV);

const mongoose = require('mongoose');
const { importExport } = require('./import-prod-json');
const { checkTables } = require('./table-checks');
const { copyPeopleAndSensors } = require('../copy-people-and-sensors-to-postgres');
const { copyEarthquakes } = require('../copy-earthquakes-to-postgres');
const { copyCommunity } = require('../copy-community-to-postgres');

async function setup(exportDir = DEFAULT_EXPORT_DIR, outputDir = DEFAULT_OUTPUT_DIR) {
  fs.mkdirSync(outputDir, { recursive: true });
  const compose = path.join(BACKEND_ROOT, 'e2e', 'docker-compose.yml');
  console.log('1. Starting the end-to-end databases');
  execFileSync('docker', ['compose', '-f', compose, 'up', '-d', '--wait'], { stdio: 'inherit' });

  console.log('2. Migrating PostgreSQL and emptying it');
  const { db } = require('../../src/db/knex');
  await db.migrate.latest();
  const { rows } = await db.raw("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE 'knex_migrations%' AND tablename <> 'spatial_ref_sys'");
  if (rows.length > 0) await db.raw(`TRUNCATE ${rows.map(() => '??').join(', ')} CASCADE`, rows.map((r) => r.tablename));

  console.log('3. Importing the export into MongoDB');
  const importReport = await importExport(exportDir, outputDir);
  for (const script of MONGO_MIGRATIONS) {
    let output;
    try {
      output = execFileSync(process.execPath, [path.join('scripts', `${script}.js`)], { cwd: BACKEND_ROOT, env: e2eEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      output = `${err.stdout || ''}${err.stderr || ''}`;
      fs.writeFileSync(path.join(outputDir, `mongo-${script}.log`), output);
      // A migration that stops on blockers in the data changes nothing: record it and go on
      if (!/Nothing was changed/.test(output)) throw new Error(`${script} failed (exit ${err.status}): see mongo-${script}.log`);
      console.log(`   ${script}: BLOCKED by the data, nothing changed (mongo-${script}.log)`);
      continue;
    }
    fs.writeFileSync(path.join(outputDir, `mongo-${script}.log`), output);
    console.log(`   ${script}: done (mongo-${script}.log)`);
  }

  console.log('4. Copying to PostgreSQL');
  const { connectOrThrow } = require('../find-duplicates');
  await connectOrThrow();
  const copies = {};
  for (const [name, copy] of [['peopleAndSensors', copyPeopleAndSensors], ['earthquakes', copyEarthquakes], ['community', copyCommunity]]) {
    const lines = [];
    copies[name] = await copy({ db, log: (line) => lines.push(line) });
    fs.writeFileSync(path.join(outputDir, `copy-${name}.log`), `${lines.join('\n')}\n`);
    console.log(`   ${name}: ${copies[name].ok ? 'validation passed' : 'VALIDATION FAILED'} (copy-${name}.log)`);
  }

  console.log('5. Checking every table and link');
  const tables = await checkTables({ db, copies });
  fs.writeFileSync(path.join(outputDir, 'table-checks.json'), `${JSON.stringify(tables, null, 2)}\n`);
  tables.counts.forEach((c) => console.log(`   ${c.addsUp ? 'ok  ' : 'FAIL'} ${c.table}: MongoDB ${c.mongodb ?? '-'}, PostgreSQL ${c.postgresql} ${JSON.stringify(c.copyReport)}`));
  Object.entries(tables.links).forEach(([name, l]) => console.log(`   ${l.failed.length === 0 ? 'ok  ' : 'FAIL'} ${name}: ${l.checked} checked, ${l.failed.length} failed`));

  console.log('6. Saving the PostgreSQL baseline (pg_dump)');
  fs.mkdirSync(path.join(outputDir, 'baseline'), { recursive: true });
  const dump = execFileSync('docker', ['compose', '-f', compose, 'exec', '-T', 'postgres', 'pg_dump', '-U', 'ehub_e2e', '-d', 'ehub_e2e', '--format=custom'], { maxBuffer: 1024 * 1024 * 1024 });
  fs.writeFileSync(path.join(outputDir, 'baseline', 'postgres.dump'), dump);
  console.log(`   baseline/postgres.dump (${Math.round(dump.length / 1024)} KB)`);

  await mongoose.disconnect();
  await db.destroy();
  const ok = Object.values(copies).every((c) => c.ok) && tables.ok;
  console.log(ok ? 'Environment ready.' : 'Setup finished with failures: see the reports.');
  return { ok, importReport, copies, tables };
}

module.exports = { setup };

if (require.main === module) {
  const [exportDir, outputDir] = process.argv.slice(2);
  setup(exportDir ? path.resolve(exportDir) : undefined, outputDir ? path.resolve(outputDir) : undefined)
    .then(({ ok }) => process.exit(ok ? 0 : 1))
    .catch((err) => {
      console.error(`e2e setup failed: ${err.stack || err.message}`);
      process.exit(2);
    });
}
