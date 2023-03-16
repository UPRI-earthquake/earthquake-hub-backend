// change value based on deployment

const env = process.env

const config = {
  db: {
    host: env.DB_HOST,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
  },
  redis: {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
  },
  mongodb: {
    host: env.MONGO_DB_HOST,
    port:  env.MONGO_DB_PORT,
    database: env.MONGO_DB_NAME,
  },
  geoserve: {
    host: env.GEOSERVE_HOST,
    port: env.GEOSERVE_PORT,
  },
};

module.exports = config;
