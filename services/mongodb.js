const mongoose = require('mongoose');
const config = require('../config');

const {NODE_ENV, DB_HOST_MONGO, DB_NAME} = process.env;

const getConnectionUrl = () => {
  const host = `mongodb://${config.mongodb.host}:${config.mongodb.port}`
                .replace(/\/$/, '');

  return `${host}/${config.mongodb.database}`
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
