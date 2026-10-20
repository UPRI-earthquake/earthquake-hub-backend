const mongoose = require('mongoose');

const {
  MONGO_CONNX_TYPE, MONGO_HOST, MONGO_PORT, MONGO_NAME,
  MONGO_USER, MONGO_PASSWORD, MONGO_AUTH_SOURCE, MONGO_REPLICA_SET,
} = process.env;

const getConnectionUrl = () => {
  if (MONGO_CONNX_TYPE == 'docker') {
    // Credentials are optional so older .env files without MONGO_USER still connect
    const auth = MONGO_USER
      ? `${encodeURIComponent(MONGO_USER)}:${encodeURIComponent(MONGO_PASSWORD || '')}@`
      : '';
    const host = `mongodb://${auth}${MONGO_HOST}:${MONGO_PORT}`
    .replace(/\/$/, '');

    const params = new URLSearchParams();
    if (MONGO_USER) params.set('authSource', MONGO_AUTH_SOURCE || 'admin');
    if (MONGO_REPLICA_SET) params.set('replicaSet', MONGO_REPLICA_SET);
    const query = params.toString();

  return `${host}/${MONGO_NAME}${query ? `?${query}` : ''}`
  } else if (MONGO_CONNX_TYPE == 'cloud') {
    return `mongodb+srv://${MONGO_HOST}/${MONGO_NAME}`;
  } else {
    console.trace('Expected mongo db type is either docker or cloud only');
  }
 
}

const connect = async (opts = {}) => {
  try {
    const dbUrl = getConnectionUrl();
    await mongoose.connect(dbUrl, opts);
    // Host/port/name come from the parsed connection, so credentials in MONGO_HOST never reach the logs
    const { host, port, name } = mongoose.connection;
    console.log(`Connected to MongoDB at ${host}:${port}/${name}`);
  } catch (err) {
    console.trace(`In MongoDB setup...\n ${err}`)
    //TODO: properly handle this scenario
  }
}

const disconnect = async () => {
  await mongoose.disconnect()
  console.log('Disconnected mongodb')
}

module.exports = {
  connect,
  getConnectionUrl,
  disconnect
};
