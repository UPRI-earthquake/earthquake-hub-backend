// The tables the end-to-end check counts, by the labels its baselines use (table-checks.json), and a
// helper to count them. A restored baseline must have the same counts as when it was saved.
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

// [{ table: <label>, postgresql: <count> }] for every table above
async function countTables(db) {
  const counts = [];
  for (const [label, table] of Object.entries(TABLES)) {
    counts.push({ table: label, postgresql: Number((await db(table).count({ n: '*' }).first()).n) });
  }
  return counts;
}

module.exports = { TABLES, countTables };
