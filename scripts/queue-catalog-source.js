require('dotenv/config');
const mongoose = require('mongoose');
const mongodb = require('../src/services/mongodb.service');

async function main() {
  const source = process.argv[2]?.trim().toLowerCase();
  if (!source) {
    throw new Error('Usage: node scripts/queue-catalog-source.js <source>');
  }

  await mongodb.connect();
  const events = mongoose.connection.collection('events');
  const result = await events.updateMany(
    { 'additionalInformation.source': { $ne: source } },
    {
      $addToSet: { pendingCatalogSources: source },
      $set: {
        [`catalogEnrichmentAttempts.${source}`]: 0,
        [`catalogEnrichmentStatus.${source}`]: 'pending',
        upForEnrichment: true,
      },
    },
  );

  await mongodb.disconnect();
  console.log(`queued source="${source}" matched=${result.matchedCount} modified=${result.modifiedCount}`);
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
