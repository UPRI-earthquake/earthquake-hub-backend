const mongoose = require('mongoose');

const {NODE_ENV, DB_HOST_MONGO, DB_NAME} = process.env;

const getConnectionUrl = () => {
  const host = `${NODE_ENV === 'production'
                  ? DB_HOST_MONGO
                  : 'mongodb://localhost:27017'}`
                .replace(/\/$/, '');
  const dbName = `${NODE_ENV === 'production'
                  ? DB_NAME
                  : 'latestEarthquakes'}`

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
