const mongoose = require('mongoose');
require('dotenv').config({path: __dirname + '/../.env'})

const {NODE_ENV, DB_HOST_MONGO, DB_NAME} = process.env;

const getConnectionUrl = () => {
  var host, connxUrl;

  if (process.env.NODE_ENV === 'production') {
    host = `mongodb://${process.env.MONGO_DB_HOST}:${process.env.MONGO_DB_PORT}`
      .replace(/\/$/, '');

    connxUrl = `${host}/${process.env.MONGO_DB_NAME}`;
  } else {
    connxUrl = process.env.MONGO_DB_DEV_CONNX_STR;
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
