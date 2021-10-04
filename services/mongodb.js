const mongoose = require('mongoose');

const {DB_CONN, DB_NAME} = process.env;

const getConnectionUrl = () => {
  const host = `${DB_CONN || 'mongodb://localhost:27017'}`.replace(/\/$/, '');
  const dbName = DB_NAME || 'latestEarthquakes'

  return `${host}/${dbName}`
}

const connect = async (opts = {}) => {
  try {
    const dbUrl = getConnectionUrl();
    await mongoose.connect(dbUrl, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      ...opts
    });
  } catch (e) {
    console.error(`Couldn't connect to mongodb: ${e}`)
    //process.exit(1);
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
