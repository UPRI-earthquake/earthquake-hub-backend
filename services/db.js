const mysql = require('mysql2/promise');
const config = require('../config');

const pool = mysql.createPool(config.db) // promise wrapped

module.exports = pool


