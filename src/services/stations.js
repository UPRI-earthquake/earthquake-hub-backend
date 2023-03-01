import db from './mysqldb.js';
import { emptyOrRows } from '../helper/helper.js';

export async function getStationLocations() {
  const [rows, fields] = await db.query(
    'SELECT code, latitude, longitude, description'
    + ' FROM Station AS table1'
    + ' WHERE end IS NULL' // metadata with no end is presently used
  );
  const data = emptyOrRows(rows);
  return data
}
