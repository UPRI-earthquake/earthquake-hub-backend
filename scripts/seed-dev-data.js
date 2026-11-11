// Fills a dev database with test data, so a developer without the old dev data can run the app and the
// frontend + backend test plan (FRONTEND_BACKEND_TEST_PLAN.md):
//
//   - dev's 906 earthquakes (2021–2026) with their PHIVOLCS/USGS matches, enrichment status and station
//     lists, from scripts/seed-data/dev-earthquakes.json.gz: public earthquake data only
//   - made-up accounts: qa_citizen_1, qa_citizen_2, qa_sensor_owner (citizens) and qa_brgy (an approved
//     brgy), all with the password QA_PASSWORD below
//   - one made-up sensor per station code the earthquakes list (17), placed in Philippine cities: three
//     linked to qa_sensor_owner (two of them forwarded by qa_brgy), the rest not linked
//
// No real account, email, password or sensor location is included. It only adds what's missing (accounts
// by username, sensors by network + station, earthquakes by publicID) and never changes or deletes
// anything, so it's safe to run on a database that already has data, and to run again.
//
//   npm run db:pg:seed            (after npm run db:pg:migrate)
//
// Exit code: 0 = done, 2 = error. Refuses to run with NODE_ENV=production.
try { require('dotenv/config'); } catch (_) { /* prod images don't ship dotenv */ }
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const bcrypt = require('bcryptjs');

const DATA_FILE = path.join(__dirname, 'seed-data', 'dev-earthquakes.json.gz');
const QA_PASSWORD = 'Qa-Password-2026!';
const PASSWORD_POLICY_VERSION = 2; // CURRENT_PASSWORD_POLICY_VERSION in src/controllers/helpers.js
const SEEDED_AT = new Date('2026-11-11T00:00:00.000Z');

const ACCOUNTS = [
  { username: 'qa_citizen_1', roles: ['citizen'] },
  { username: 'qa_citizen_2', roles: ['citizen'] },
  { username: 'qa_sensor_owner', roles: ['citizen'] },
  { username: 'qa_brgy', roles: ['brgy'], is_approved: true, ringserver_url: 'qa-brgy.example.org', ringserver_port: 18000 },
];

// Where the made-up sensors are placed, one per station code (in code order)
const CITIES = [
  ['Quezon City', 14.65, 121.05], ['Cebu City', 10.32, 123.89], ['Davao City', 7.07, 125.61], ['Baguio', 16.41, 120.59],
  ['Iloilo City', 10.72, 122.56], ['Cagayan de Oro', 8.48, 124.65], ['Legazpi', 13.14, 123.74], ['Zamboanga City', 6.92, 122.08],
  ['Tacloban', 11.24, 125.0], ['Puerto Princesa', 9.74, 118.74], ['Tuguegarao', 17.61, 121.73], ['General Santos', 6.12, 125.17],
  ['Laoag', 18.2, 120.59], ['Butuan', 8.95, 125.54], ['Naga', 13.62, 123.19], ['Dumaguete', 9.31, 123.31], ['Lucena', 13.94, 121.62],
];
const OWNED_SENSORS = 3;
const FORWARDED_SENSORS = 2;

const readData = () => JSON.parse(zlib.gunzipSync(fs.readFileSync(DATA_FILE)).toString('utf8'));

/***************************************************************************
  * seedDevData:
  *     Adds the test accounts, sensors and earthquakes that are missing.
  *
  * Inputs:
  *     db:   Knex instance for PostgreSQL
  *     log:  function for progress lines (default console.log)
  *
  * Outputs:
  *     { accounts, devices, forwarding, events, catalogMatches, catalogStatus, stations }: each
  *     { added, existing } (stations: { added, existing, withoutSensor })
  ***************************************************************************/
async function seedDevData({ db, log = console.log }) {
  const data = readData();
  const count = () => ({ added: 0, existing: 0 });
  const result = {
    accounts: count(), devices: count(), forwarding: count(), events: count(),
    catalogMatches: count(), catalogStatus: count(), stations: { ...count(), withoutSensor: 0 },
  };

  await db.transaction(async (trx) => {
    // Accounts
    const passwordHash = bcrypt.hashSync(QA_PASSWORD, 10);
    const accountIds = new Map();
    for (const account of ACCOUNTS) {
      const existing = await trx('accounts').where({ username: account.username }).first('id');
      if (existing) {
        result.accounts.existing += 1;
        accountIds.set(account.username, existing.id);
        continue;
      }
      const [row] = await trx('accounts').insert({
        email: `${account.username.replace(/_/g, '.')}@example.org`,
        password_hash: passwordHash,
        password_policy_version: PASSWORD_POLICY_VERSION,
        password_updated_at: SEEDED_AT,
        created_at: SEEDED_AT,
        updated_at: SEEDED_AT,
        ...account,
        roles: trx.raw('?::account_role[]', [account.roles]),
      }).returning('id');
      result.accounts.added += 1;
      accountIds.set(account.username, row.id);
    }

    // Sensors: one per station code the earthquakes list
    const codes = [...new Set(data.stations.map((station) => station.station))].sort();
    const deviceIds = new Map();
    for (const [index, code] of codes.entries()) {
      const existing = await trx('devices').where({ network: 'AM', station: code }).first('id');
      if (existing) {
        result.devices.existing += 1;
        deviceIds.set(code, existing.id);
        continue;
      }
      const [city, latitude, longitude] = CITIES[index % CITIES.length];
      const owned = index < OWNED_SENSORS;
      const [row] = await trx('devices').insert({
        owner_account_id: owned ? accountIds.get('qa_sensor_owner') : null,
        network: 'AM',
        station: code,
        description: `QA test sensor in ${city}`,
        stream_id: owned ? `AM_${code}_.*/MSEED` : null,
        mac_address: owned ? `02:00:00:00:00:${String(index + 1).padStart(2, '0')}` : null,
        latitude,
        longitude,
        elevation_m: 50,
        activity: owned ? 'active' : 'unlinked',
        activity_toggled_at: SEEDED_AT,
        created_at: SEEDED_AT,
        updated_at: SEEDED_AT,
      }).returning('id');
      result.devices.added += 1;
      deviceIds.set(code, row.id);
    }

    // qa_brgy forwards two of qa_sensor_owner's sensors: only ones this seed made, never a real sensor
    const seededOwned = await trx('devices')
      .where({ owner_account_id: accountIds.get('qa_sensor_owner') })
      .where('description', 'like', 'QA test sensor%')
      .orderBy('station').limit(FORWARDED_SENSORS).pluck('id');
    for (const deviceId of seededOwned) {
      const link = { brgy_account_id: accountIds.get('qa_brgy'), device_id: deviceId };
      const inserted = await trx('brgy_forwarded_devices').insert({ ...link, added_at: SEEDED_AT })
        .onConflict(['brgy_account_id', 'device_id']).ignore().returning('device_id');
      result.forwarding[inserted.length > 0 ? 'added' : 'existing'] += 1;
    }

    // Earthquakes, with their rows, for those not there yet
    const existingPublicIds = new Set(await trx('events').pluck('public_id'));
    const takenLegacyIds = new Set((await trx('events').whereNotNull('legacy_mongo_id').pluck('legacy_mongo_id')).map((id) => id.trim()));
    const eventIds = new Map();
    for (const event of data.events) {
      if (existingPublicIds.has(event.public_id)) {
        result.events.existing += 1;
        continue;
      }
      const [row] = await trx('events').insert({
        ...event,
        legacy_mongo_id: event.legacy_mongo_id && !takenLegacyIds.has(event.legacy_mongo_id) ? event.legacy_mongo_id : null,
      }).returning('id');
      result.events.added += 1;
      eventIds.set(event.public_id, row.id);
    }

    const rowsFor = (list, key, toRow) => {
      const rows = [];
      list.forEach((item) => {
        const eventId = eventIds.get(item.public_id);
        if (!eventId) result[key].existing += 1;
        else {
          const row = toRow(item, eventId);
          if (row) rows.push(row);
        }
      });
      return rows;
    };
    const insertAll = async (table, rows) => {
      for (let i = 0; i < rows.length; i += 500) await trx(table).insert(rows.slice(i, i + 500));
      return rows.length;
    };

    result.catalogMatches.added = await insertAll('event_catalog_matches', rowsFor(data.catalogMatches, 'catalogMatches',
      ({ public_id: _publicId, ...match }, eventId) => ({ ...match, event_id: eventId })));
    result.catalogStatus.added = await insertAll('event_catalog_status', rowsFor(data.catalogStatus, 'catalogStatus',
      ({ public_id: _publicId, ...status }, eventId) => ({ ...status, event_id: eventId })));
    result.stations.added = await insertAll('event_stations', rowsFor(data.stations, 'stations', (station, eventId) => {
      const deviceId = deviceIds.get(station.station);
      if (!deviceId) {
        result.stations.withoutSensor += 1;
        return null;
      }
      return { event_id: eventId, device_id: deviceId, kind: station.kind, position: station.position };
    }));
  });

  const line = (label, { added, existing }) => log(`  ${label}: added ${added}, already there ${existing}`);
  log(`Seeded from ${path.basename(DATA_FILE)} (${data.exportedFrom}):`);
  line('accounts (qa_citizen_1, qa_citizen_2, qa_sensor_owner, qa_brgy)', result.accounts);
  line('sensors', result.devices);
  line('brgy forwarding links', result.forwarding);
  line('earthquakes', result.events);
  line('catalog matches', result.catalogMatches);
  line('enrichment status rows', result.catalogStatus);
  line('station links', result.stations);
  log(`Test accounts sign in with the password ${QA_PASSWORD}`);
  return result;
}

module.exports = { seedDevData, QA_PASSWORD };

if (require.main === module) {
  if (process.env.NODE_ENV === 'production') {
    console.error('seed-dev-data refuses to run with NODE_ENV=production: it adds test accounts.');
    process.exit(2);
  }
  const postgres = require('../src/db/knex');
  seedDevData({ db: postgres.db })
    .then(async () => {
      await postgres.db.destroy();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error(`seed-dev-data failed: ${err.message}`);
      await postgres.db.destroy().catch(() => {});
      process.exit(2);
    });
}
