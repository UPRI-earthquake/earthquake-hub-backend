const mongoose = require('mongoose');

const { MONGO_DB_TYPE, MONGO_DB_HOST, MONGO_DB_NAME, MONGO_HOST, MONGO_PORT, MONGO_NAME } = process.env;

const getConnectionUrl = () => {
  if (MONGO_DB_TYPE == 'docker') {
    const host = `mongodb://${MONGO_HOST}:${MONGO_PORT}`
    .replace(/\/$/, '');

  return `${host}/${MONGO_NAME}`
  } else if (MONGO_DB_TYPE == 'cloud') {
    return `mongodb+srv://${MONGO_DB_HOST}/${MONGO_DB_NAME}`;
  } else {
    console.trace('Expected mongo db type is either docker or cloud only');
  }
 
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
