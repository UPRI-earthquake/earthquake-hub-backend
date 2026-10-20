// Shared Knex instance: the backend's one PostgreSQL connection pool. Import `db` to query PostgreSQL.
const knex = require('knex');
const config = require('./knexfile');

// Creating the instance doesn't connect; the pool opens connections on the first query
const db = knex(config);

// Checks PostgreSQL is reachable and logs where. Like the MongoDB connect, a failure is logged but
// doesn't stop the backend. Doesn't look at tables, so an unmigrated database is fine.
const connect = async () => {
  try {
    const { rows: [server] } = await db.raw(
      "SELECT current_database() AS database, current_setting('server_version') AS version",
    );
    const { host, port } = config.connection;
    console.log(`Connected to PostgreSQL ${server.version} at ${host}:${port}/${server.database}`);
  } catch (err) {
    console.trace(`In PostgreSQL setup...\n ${err}`);
  }
};

const disconnect = async () => {
  await db.destroy();
  console.log('Disconnected postgresql');
};

module.exports = {
  db,
  connect,
  disconnect,
};
