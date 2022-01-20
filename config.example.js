const env = process.env

const config = {
  db: {
    host: env.NODE_ENV === 'production' ? env.DB_HOST : 'localhost',
    user: env.NODE_ENV === 'production' ? env.DB_USER : 'username',
    password: env.NODE_ENV === 'production' ? env.DB_PASSWORD: 'password',
    database: env.NODE_ENV === 'production' ? env.DB_NAME: 'seiscomp',
  },
};

module.exports = config;
