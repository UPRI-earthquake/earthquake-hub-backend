const env = process.env

const config = {
  db: {
    host: env.NODE_ENV === 'production' ? env.DB_HOST : 'localhost',
    user: env.NODE_ENV === 'production' ? env.DB_USER : 'username',
    password: env.NODE_ENV === 'production' ? env.DB_PASSWORD: 'password',
    database: env.NODE_ENV === 'production' ? env.DB_NAME: 'seiscomp',
  },
  redis: {
    host: env.NODE_ENV === 'production' ? env.REDIS_HOST : 'localhost',
    port: env.REDIS_PORT,
  },
  mongodb: {
    host: env.NODE_ENV === 'production' ? env.MONGO_DB_HOST: 'localhost',
    port: env.NODE_ENV === 'production' ? env.MONGO_DB_PORT: '27017',
    database: env.NODE_ENV === 'production' ? env.MONGO_DB_NAME: 'latestEQs',
  },
  nominatim: {
    host: env.NODE_ENV === 'production' ? env.NOMINATIM_HOST: 'localhost',
    port: env.NODE_ENV === 'production' ? env.NOMINATIM_PORT: '8080',
  },
};

module.exports = config;
