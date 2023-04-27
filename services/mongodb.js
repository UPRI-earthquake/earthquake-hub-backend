const mongoose = require('mongoose');
require('dotenv').config({path: __dirname + '/../.env'})

const { MONGO_DB_TYPE, MONGO_DB_CLOUD, MONGO_DB_HOST, MONGO_DB_PORT, MONGO_DB_NAME } = process.env;

const getConnectionUrl = () => {
  var host, connxUrl;

  if (MONGO_DB_TYPE != 'cloud') {
    host = `mongodb://${MONGO_DB_HOST}:${MONGO_DB_PORT}`
      .replace(/\/$/, '');

    connxUrl = `${host}/${MONGO_DB_NAME}`;
  } else {
    connxUrl = MONGO_DB_CLOUD;
  }

  return connxUrl;
}

const connect = async (opts = {}) => {
  try {
    const dbUrl = getConnectionUrl();
    await mongoose.connect(dbUrl, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      ...opts
    });
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
