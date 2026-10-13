// Helpers for checking that a query uses an index, shared by the migration scripts.

// Returns the winning plan's stages from top to bottom, e.g. ['LIMIT', 'FETCH', 'IXSCAN'].
async function planStages(collection, filter, { sort } = {}) {
  let cursor = collection.find(filter);
  if (sort) cursor = cursor.sort(sort);
  const explained = await cursor.limit(1).explain('queryPlanner');
  const stages = [];
  let stage = explained.queryPlanner.winningPlan;
  // MongoDB 8 may wrap the classic plan in queryPlan
  if (stage.queryPlan) stage = stage.queryPlan;
  while (stage) {
    stages.push(stage.stage);
    stage = stage.inputStage;
  }
  return stages;
}

// An index is used and, if the query sorts, the sort comes from the index (no in-memory SORT stage).
function usesIndex(stages) {
  const indexed = stages.some((s) => ['IXSCAN', 'EXPRESS_IXSCAN', 'IDHACK'].includes(s));
  return indexed && !stages.includes('SORT');
}

module.exports = { planStages, usesIndex };
