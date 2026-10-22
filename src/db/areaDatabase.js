// During the PostgreSQL migration each area of data lives in exactly one database, chosen by its own
// setting (e.g. JOB_LOCKS_DB=postgres). Rolling an area back is a config change plus a restart.
const DATABASES = ['mongodb', 'postgres'];

// The database an area uses, from its setting. Unset means mongodb, so environments that haven't
// opted in (production) keep running on MongoDB. Throws on an unknown value so a typo fails at startup.
const areaDatabase = (settingKey) => {
  const raw = process.env[settingKey];
  const value = (raw || 'mongodb').trim().toLowerCase();
  if (!DATABASES.includes(value)) {
    throw new Error(`${settingKey} must be "mongodb" or "postgres" (got "${raw}")`);
  }
  return value;
};

// Picks an area's repository implementation. Only the chosen one is loaded, so an area on PostgreSQL
// never loads its Mongoose model (which would otherwise build indexes in MongoDB on connect).
const selectRepository = (area, settingKey, implementations) => {
  const database = areaDatabase(settingKey);
  console.log(`[db] ${area}: ${database} (${settingKey})`);
  return implementations[database]();
};

module.exports = {
  areaDatabase,
  selectRepository,
};
