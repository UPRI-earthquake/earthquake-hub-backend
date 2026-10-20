// Testcontainers fixture: starts a throwaway MongoDB (single-node replica set) and connects the
// app's Mongoose to it. Needs Docker, so only *.integration.test.js use it (npm run test:integration).
//
//   let mongo;
//   beforeAll(async () => { mongo = await startMongo(); }, MONGO_STARTUP_TIMEOUT_MS);
//   afterEach(() => mongo.clear());
//   afterAll(() => mongo && mongo.stop());
const mongoose = require('mongoose');
const { MongoDBContainer } = require('@testcontainers/mongodb');

// Keep in sync with the mongodb service in docker-compose.yml
const MONGO_IMAGE = 'mongo:8.0.32';

// The first run pulls the image, which can take a while
const MONGO_STARTUP_TIMEOUT_MS = 180_000;

// Require the models a test needs before calling this, so their indexes (unique, TTL) get built
const startMongo = async () => {
  const container = await new MongoDBContainer(MONGO_IMAGE).start();

  // directConnection: the replica set member's hostname only resolves inside the container
  await mongoose.connect(`${container.getConnectionString()}/ehub_test?directConnection=true`);
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));

  // Empties every collection but keeps the indexes
  const clear = async () => {
    const collections = await mongoose.connection.db.collections();
    await Promise.all(collections.map((collection) => collection.deleteMany({})));
  };

  const stop = async () => {
    await mongoose.disconnect();
    await container.stop();
  };

  return { container, clear, stop };
};

module.exports = {
  MONGO_IMAGE,
  MONGO_STARTUP_TIMEOUT_MS,
  startMongo,
};
