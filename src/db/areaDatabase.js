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
// options.dependsOn: the settings of areas whose tables this area's tables point to (foreign keys).
// It can only be on PostgreSQL when they are too, so a mismatch stops the backend at startup.
const selectRepository = (area, settingKey, implementations, { dependsOn = [] } = {}) => {
  const database = areaDatabase(settingKey);
  const notMoved = database === 'postgres' ? dependsOn.filter((key) => areaDatabase(key) !== 'postgres') : [];
  if (notMoved.length > 0) {
    throw new Error(
      `${settingKey}=postgres needs ${notMoved.map((key) => `${key}=postgres`).join(' and ')}: ${area} point to that data in PostgreSQL`,
    );
  }
  console.log(`[db] ${area}: ${database} (${settingKey})`);
  return implementations[database]();
};

module.exports = {
  areaDatabase,
  selectRepository,
};
