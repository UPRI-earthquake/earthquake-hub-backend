// Queues a catalog (phivolcs or usgs) for the nightly enrichment job on every earthquake it hasn't
// matched yet, e.g. after the catalog was unreachable for a while: each such event's status row for it
// becomes pending with no attempts (EventsRepo.queueCatalogSource). Events it has matched keep theirs.
//
//   node scripts/queue-catalog-source.js <phivolcs | usgs>
require('dotenv/config');
const { db } = require('../src/db/knex');
const EventsRepo = require('../src/repositories/events.repo');

async function main() {
  const source = process.argv[2]?.trim().toLowerCase();
  if (!source) {
    throw new Error('Usage: node scripts/queue-catalog-source.js <phivolcs | usgs>');
  }
  const queued = await EventsRepo.queueCatalogSource(source);
  console.log(`queued source="${source}" events=${queued}`);
}

main()
  .catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
