// Shared steps of the MongoDB -> PostgreSQL copy scripts (scripts/copy-*-to-postgres.js). Rows are
// matched by legacy_mongo_id (the MongoDB _id), which makes every copy safe to run again.
const BATCH_SIZE = 500;

const chunk = (items, size = BATCH_SIZE) => Array.from(
  { length: Math.ceil(items.length / size) },
  (_, i) => items.slice(i * size, (i + 1) * size),
);

const toDate = (value) => {
  if (value === null || value === undefined) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

// updated_at of rows already copied, by legacy id
async function copiedUpdatedAt(db, table, legacyIds) {
  const byLegacyId = new Map();
  for (const batch of chunk(legacyIds)) {
    const rows = await db(table).select('legacy_mongo_id', 'updated_at').whereIn('legacy_mongo_id', batch);
    rows.forEach((row) => byLegacyId.set(row.legacy_mongo_id.trim(), row.updated_at));
  }
  return byLegacyId;
}

/***************************************************************************
  * upsertByLegacyId:
  *     Inserts rows not copied yet and refreshes copied ones, except rows changed in PostgreSQL since
  *     they were copied (newer updated_at), so a re-run after the switch never overwrites newer data.
  *     All in one transaction. Rows must carry legacy_mongo_id and updated_at (the trigger keeps an
  *     explicitly set updated_at, so MongoDB's timestamps survive).
  *
  * Inputs:
  *     db, table, rows
  *     columns:  the columns a refresh overwrites
  *     dryRun:   count what would happen without writing
  *
  * Outputs:
  *     { inserted, updated, keptNewer }
 ***************************************************************************/
async function upsertByLegacyId({ db, table, rows, columns, dryRun = false }) {
  const counts = { inserted: 0, updated: 0, keptNewer: 0 };

  if (dryRun) {
    const copied = await copiedUpdatedAt(db, table, rows.map((row) => row.legacy_mongo_id));
    rows.forEach((row) => {
      const updatedAt = copied.get(row.legacy_mongo_id);
      if (!updatedAt) counts.inserted += 1;
      else if (updatedAt <= row.updated_at) counts.updated += 1;
      else counts.keptNewer += 1;
    });
    return counts;
  }

  await db.transaction(async (trx) => {
    for (const batch of chunk(rows)) {
      // RETURNING gives only the rows actually written; xmax = 0 marks a fresh insert
      const written = await trx(table)
        .insert(batch)
        .onConflict('legacy_mongo_id')
        .merge(columns)
        .where(`${table}.updated_at`, '<=', trx.ref('excluded.updated_at'))
        .returning([trx.raw('(xmax = 0) AS inserted')]);
      const inserted = written.filter((row) => row.inserted).length;
      counts.inserted += inserted;
      counts.updated += written.length - inserted;
      counts.keptNewer += batch.length - written.length;
    }
  });
  return counts;
}

// Legacy ids that have no row in `table`
async function missingLegacyIds(db, table, legacyIds) {
  const present = new Set();
  for (const batch of chunk(legacyIds)) {
    const rows = await db(table).select('legacy_mongo_id').whereIn('legacy_mongo_id', batch);
    rows.forEach((row) => present.add(row.legacy_mongo_id.trim()));
  }
  return legacyIds.filter((id) => !present.has(id));
}

module.exports = {
  BATCH_SIZE,
  chunk,
  toDate,
  upsertByLegacyId,
  missingLegacyIds,
};
