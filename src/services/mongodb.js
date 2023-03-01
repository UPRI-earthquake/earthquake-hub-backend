import mongoose from 'mongoose';
import { config } from '../../config.js';

const { NODE_ENV, DB_HOST_MONGO, DB_NAME } = process.env;

export const getConnectionUrl = () => {
  const host = `mongodb://${config.mongodb.host}:${config.mongodb.port}`
    .replace(/\/$/, '');

  return `${host}/${config.mongodb.database}`
}

export const connectToMongoDb = async (opts = {}) => {
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

export const disconnect = async () => {
  await mongoose.disconnect()
  console.log('Disconnected mongodb')
}