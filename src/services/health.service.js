const mongoose = require('mongoose');

function readiness(connection = mongoose.connection) {
  const databaseReady = connection.readyState === 1;
  return {
    ready: databaseReady,
    payload: {
      status: databaseReady ? 'ready' : 'not_ready',
      dependencies: { mongodb: databaseReady ? 'ready' : 'unavailable' },
    },
  };
}

module.exports = { readiness };
