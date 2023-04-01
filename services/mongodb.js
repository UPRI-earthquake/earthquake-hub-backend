const mongoose = require('mongoose');

const getConnectionUrl = () => {
  const host = `mongodb://${process.env.MONGO_HOST}:${process.env.MONGO_PORT}`
                .replace(/\/$/, '');

  return `${host}/${process.env.MONGO_NAME}`
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
