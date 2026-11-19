require('dotenv/config');
const mongoose = require('mongoose');
const mongodb = require('../src/services/mongodb.service');

const DEFAULT_SOURCES = ['phivolcs', 'usgs'];

function mapToObject(value) {
  if (!value) return {};
  if (value instanceof Map) return Object.fromEntries(value.entries());
  if (typeof value === 'object') return value;
  return {};
}

function normalizeAdditionalInformation(value) {
  if (Array.isArray(value)) {
    return value
      .filter((entry) => entry && typeof entry === 'object' && entry.source)
      .map((entry) => ({ ...entry, source: String(entry.source).toLowerCase() }));
  }

  if (value && typeof value === 'object') {
    return Object.entries(value)
      .filter(([, entry]) => entry && typeof entry === 'object')
      .map(([source, entry]) => ({
        source: String(entry.source || source).toLowerCase(),
        ...entry,
      }));
  }

  return [];
}

function buildStatus(doc, additionalInformation) {
  const status = mapToObject(doc.catalogEnrichmentStatus);
  const sourceSet = new Set(additionalInformation.map((entry) => entry.source));

  DEFAULT_SOURCES.forEach((source) => {
    if (status[source]) return;
    if (sourceSet.has(source)) {
      status[source] = 'done';
      return;
    }

    if (
      doc.additionalInformation &&
      !Array.isArray(doc.additionalInformation) &&
      Object.prototype.hasOwnProperty.call(doc.additionalInformation, source)
    ) {
      status[source] = doc.additionalInformation[source] ? 'done' : 'no_match';
    }
  });

  return status;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  await mongodb.connect();
  const events = mongoose.connection.collection('events');
  const cursor = events.find({});

  let scannedCount = 0;
  let changedCount = 0;
  const operations = [];

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    scannedCount += 1;

    const additionalInformation = normalizeAdditionalInformation(doc.additionalInformation);
    const catalogEnrichmentStatus = buildStatus(doc, additionalInformation);
    const catalogEnrichmentAttempts = mapToObject(doc.catalogEnrichmentAttempts);

    operations.push({
      updateOne: {
        filter: { _id: doc._id },
        update: {
          $set: {
            additionalInformation,
            pendingCatalogSources: Array.isArray(doc.pendingCatalogSources) ? doc.pendingCatalogSources : [],
            catalogEnrichmentAttempts,
            catalogEnrichmentStatus,
            upForEnrichment: false,
          },
        },
      },
    });
    changedCount += 1;
  }

  if (!dryRun && operations.length > 0) {
    await events.bulkWrite(operations, { ordered: false });
  }

  await mongodb.disconnect();
  console.log(
    `migrate-catalog-info-to-array ${dryRun ? '(dry run) ' : ''}` +
    `scanned=${scannedCount} updated=${dryRun ? 0 : changedCount}`,
  );
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
