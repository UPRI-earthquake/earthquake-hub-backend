const mysql = require('mysql2/promise');
require('dotenv').config({path: __dirname + '/../.env'})

const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_NAME,
  }) // promise wrapped

module.exports = pool


