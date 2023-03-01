import mysql from 'mysql2/promise';
import { config } from '../../config.js';

const pool = mysql.createPool(config.db) // promise wrapped

export default pool;


