# PostgreSQL: Local Setup, Migrations & GUI Clients

The backend is moving from MongoDB to **PostgreSQL 18 with PostGIS 3.6**, one area at a time. During the migration both databases run side by side in Docker, and the backend connects to both on startup. Each area of data lives in exactly one of them at a time, chosen by a setting in `.env` ([section 6](#6-moving-an-area-the-per-area-switch)). On PostgreSQL so far: **job locks**, **push subscriptions** and **significant earthquakes**, the whole Step 1 pilot ([section 7](#7-tables)).

Queries and schema changes go through [Knex](https://knexjs.org): `src/db/knex.js` holds the connection pool, `src/db/migrations/` the versioned schema changes.

1. [First-time local setup](#1-first-time-local-setup)
2. [Running migrations](#2-running-migrations)
3. [Connecting with a GUI client](#3-connecting-with-a-gui-client)
4. [Integration tests](#4-integration-tests)
5. [Repositories and golden files](#5-repositories-and-golden-files)
6. [Moving an area: the per-area switch](#6-moving-an-area-the-per-area-switch)
7. [Tables](#7-tables)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. First-time local setup

### 1.1 Add the PostgreSQL keys to your `.env`

Copy these keys from [`.env.example`](.env.example) into your `.env` and set your own password. `.env` is gitignored, so it stays on your machine.

```env
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=earthquake_hub
PG_USER=ehub
PG_PASSWORD=<long random password>
```

To generate a password:

```sh
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

| Key | Meaning |
|---|---|
| `PG_HOST`, `PG_PORT` | How **your machine** reaches PostgreSQL (migrations, GUI clients, scripts). `PG_PORT` is also the port the container publishes on `127.0.0.1`. |
| `PG_DATABASE`, `PG_USER`, `PG_PASSWORD` | The database and user the container creates on its first start. The backend and migrations use the same user. |

The backend container doesn't use `PG_HOST`/`PG_PORT` from `.env`: `docker-compose.yml` sets them to `postgres:5432`, the address inside the Docker network.

**Port 5432 already taken?** If you run PostgreSQL on your machine, set `PG_PORT=5433` (or any free port). The container then publishes on that port and everything else follows.

### 1.2 Start

```sh
docker compose up -d
docker compose ps        # earthquake-hub-postgres and mongodb should both show (healthy)
```

Docker Compose creates the `earthquake-hub-postgres-data` volume on first start. If you haven't set up MongoDB yet, follow [MONGODB.md](MONGODB.md) first: the compose file needs both sets of keys.

On the first start of an **empty** volume, PostgreSQL creates the `PG_USER` user (a superuser inside this container) and the `PG_DATABASE` database. The image's own PostGIS init script is skipped on purpose, so the database starts with no extensions: the first migration adds them.

The backend waits until PostgreSQL is healthy, then logs:

```
Connected to MongoDB at mongodb:27017/latestEQs
Connected to PostgreSQL 18.6 (...) at postgres:5432/earthquake_hub
```

It starts fine on an empty, unmigrated database. If PostgreSQL can't be reached, it logs the error and keeps running, since no feature uses PostgreSQL yet.

### 1.3 Apply the migrations

```sh
npm run db:pg:migrate
```

See [section 2](#2-running-migrations).

### 1.4 Check it works

```sh
docker exec earthquake-hub-postgres psql -U ehub -d earthquake_hub -c "SELECT extname, extversion FROM pg_extension"
#  extname | extversion
#  plpgsql | 1.0
#  postgis | 3.6.x
#  citext  | 1.8
```

### Starting over

To delete all local PostgreSQL data and start from an empty database:

```sh
docker compose down
docker volume rm earthquake-hub-postgres-data
docker compose up -d
npm run db:pg:migrate
```

Changing `PG_USER`, `PG_PASSWORD` or `PG_DATABASE` in `.env` only takes effect on an empty volume, so do this after changing them.

---

## 2. Running migrations

| Command | What it does |
|---|---|
| `npm run db:pg:migrate` | Applies all pending migrations (as one batch) |
| `npm run db:pg:rollback` | Undoes the last batch |
| `npm run db:pg:status` | Lists completed and pending migrations |
| `npm run db:pg:make -- <name>` | Creates a new, empty migration file in `src/db/migrations/` |

Run them from the repo root on your machine. They read `.env`, so they reach the container through `localhost:PG_PORT`. They also work inside the backend container, where they use `postgres:5432`:

```sh
docker exec -w /app earthquake-hub-backend-dev npm run db:pg:migrate
```

Applied migrations are recorded in the `knex_migrations` table.

### Writing a migration

- One migration per change, named after what it does: `npm run db:pg:make -- create_job_locks`.
- Every migration has an `up` and a `down`. Check that `down` really undoes `up`: run `db:pg:migrate`, `db:pg:rollback`, `db:pg:migrate`.
- Never edit a migration that's already merged; add a new one instead. Other developers' databases have already run the old version.
- The first migration, `20261020000000_enable_extensions.js`, enables `postgis` (geography columns, spatial queries) and `citext` (case-insensitive text, for emails and usernames).

### Using the connection in code

```js
const { db } = require('../db/knex');

const locks = await db('job_locks').where('expires_at', '<', db.fn.now());
```

Import the shared `db` instance; don't create another Knex instance, or you get a second connection pool.

---

## 3. Connecting with a GUI client

Port `PG_PORT` (default `5432`) is published on `127.0.0.1` only, so you can connect from your own machine. Use these settings in any client:

| Setting | Value |
|---|---|
| Host | `localhost` |
| Port | `PG_PORT` from your `.env` (default `5432`) |
| Database | `earthquake_hub` (`PG_DATABASE`) |
| Username | `ehub` (`PG_USER`) |
| Password | `PG_PASSWORD` from your `.env` |
| SSL | Off (local only) |

Or as a connection URI:

```
postgresql://ehub:<PG_PASSWORD>@localhost:5432/earthquake_hub
```

### DBeaver

1. **Database → New Database Connection → PostgreSQL**.
2. Fill in host, port, database, username and password from the table above.
3. Click **Test Connection**. On first use DBeaver offers to download the PostgreSQL driver; accept.
4. Tables are under **earthquake_hub → Schemas → public → Tables**. DBeaver shows PostGIS `geography` columns on a map in the **Spatial** tab.

### pgAdmin

1. Right-click **Servers → Register → Server**.
2. **General** tab: any name, e.g. `earthquake-hub (local)`.
3. **Connection** tab: host, port, maintenance database `earthquake_hub`, username and password from the table above.
4. Tables are under **Databases → earthquake_hub → Schemas → public → Tables**.

### psql

No local install needed; use the one in the container:

```sh
docker exec -it earthquake-hub-postgres psql -U ehub -d earthquake_hub
```

---

## 4. Integration tests

Tests that need a real PostgreSQL use the [Testcontainers](https://testcontainers.com) fixture in [`__tests__/fixtures/postgres.fixture.js`](__tests__/fixtures/postgres.fixture.js). It starts a throwaway container from the same image, runs the migrations, and removes it afterwards. Your local database isn't touched.

```js
const { startPostgres, PG_STARTUP_TIMEOUT_MS } = require('./fixtures/postgres.fixture');

let pg;
beforeAll(async () => { pg = await startPostgres(); }, PG_STARTUP_TIMEOUT_MS);
afterAll(() => pg && pg.stop());

test('...', async () => {
  const rows = await pg.db('job_locks').select();
});
```

Name these files `*.integration.test.js`. They need Docker, so `npm test` skips them; run them on your machine with:

```sh
npm run test:integration
```

The first run pulls the `postgis/postgis` image, which takes a minute. They can't run inside the backend container, which has no access to Docker.

A MongoDB fixture, [`__tests__/fixtures/mongo.fixture.js`](__tests__/fixtures/mongo.fixture.js), does the same for areas still on MongoDB.

---

## 5. Repositories and golden files

Each area moves to PostgreSQL behind a **repository**: a module in `src/repositories/` that holds all of that area's database calls. Services call the repository, never a Mongoose model or Knex directly, so moving an area means writing a PostgreSQL version of its repository and nothing above it.

An area that has moved has both versions, in `src/repositories/mongodb/` and `src/repositories/postgres/`. `src/repositories/<area>.repo.js` loads the one its setting picks ([section 6](#6-moving-an-area-the-per-area-switch)).

| Area | Repository | Setting | Database in dev |
|---|---|---|---|
| Job locks | `src/repositories/jobLocks.repo.js` | `JOB_LOCKS_DB` | PostgreSQL |
| Push subscriptions | `src/repositories/pushSubscriptions.repo.js` | `PUSH_SUBSCRIPTIONS_DB` | PostgreSQL |
| Significant earthquakes | `src/repositories/significantEqs.repo.js` | `SIGNIFICANT_EQS_DB` | PostgreSQL |
| Accounts | `src/repositories/accounts.repo.js` | (Step 2) | MongoDB |
| Devices (and each account's device list and release history) | `src/repositories/devices.repo.js` | (Step 2) | MongoDB |

Repositories return plain objects with an `id`, never database documents, and services change data only through repository functions, so a PostgreSQL version can stand in unchanged. Two shared helpers keep the rest database-neutral:

- `src/repositories/errors.js`: a write that breaks a unique rule throws `DuplicateKeyError` (with the colliding `fields`), whichever database rejected it.
- `src/repositories/transactions.js`: `withTransaction(async (tx) => { ... })` runs writes together; repository functions join it when passed `{ tx }`.

Two kinds of integration tests check that a move changes nothing:

- **Repository tests** (`__tests__/<area>.repo.integration.test.js`) describe what each repository function does with real data. They run the same cases against the MongoDB and the PostgreSQL version.
- **Golden files** (`__tests__/golden/*.json`) are recorded API responses: status, key headers (including `Set-Cookie`) and body. The `*.golden.*.integration.test.js` files run the real app against seeded data and compare each response with its recording: `pilotAreas` once with the areas on PostgreSQL and once on MongoDB, `peopleAndSensors` (accounts and devices) on MongoDB until Step 2 moves them.

Values that change on every run are made stable before comparing (see `__tests__/fixtures/golden.js`): a JWT is recorded as its decoded claims (`iat` as `<now>`, `exp` as `<now + Ns>`), timestamps from the current run as `<now>`, and random secrets and newly generated ids as placeholders. Seeded data uses fixed past dates, which are recorded as they are.

Re-record golden files only when a response is meant to change, and review the diff in the PR:

```sh
UPDATE_GOLDEN=1 npm run test:integration
# PowerShell: $env:UPDATE_GOLDEN=1; npm run test:integration; Remove-Item Env:UPDATE_GOLDEN
```

---

## 6. Moving an area: the per-area switch

Each moved area has a setting in `.env` that picks its database:

```env
JOB_LOCKS_DB=postgres            # mongodb | postgres
PUSH_SUBSCRIPTIONS_DB=postgres   # mongodb | postgres
SIGNIFICANT_EQS_DB=postgres      # mongodb | postgres
```

Unset means `mongodb`, so an environment that doesn't set it (production) stays on MongoDB. An unknown value stops the backend at startup. The backend reads these on startup and logs its choice:

```
[db] push subscriptions: postgres (PUSH_SUBSCRIPTIONS_DB)
[db] job locks: postgres (JOB_LOCKS_DB)
```

While an area is on PostgreSQL, the backend doesn't read or write its MongoDB collection at all (it doesn't even load the Mongoose model). An area is never written to both databases.

### Switching an area to PostgreSQL

1. Apply the migrations: `npm run db:pg:migrate`.
2. Copy the area's data, if it has a copy script (see below). Do a dry run first.
3. Set the area's setting to `postgres` in `.env` and restart the backend: `docker restart earthquake-hub-backend-dev`.
4. Check the `[db]` line in `docker logs earthquake-hub-backend-dev`.

### Rolling an area back

Set its setting to `mongodb` and restart the backend. MongoDB still has the data as it was at the switch. Anything written to PostgreSQL since then stays there and isn't copied back.

### Copying push subscriptions

[`scripts/copy-subscriptions-to-postgres.js`](scripts/copy-subscriptions-to-postgres.js) copies MongoDB `subscriptions` into `push_subscriptions`. It reaches MongoDB as `mongodb`, so run it inside the backend container:

```sh
docker exec -w /app earthquake-hub-backend-dev npm run db:pg:copy-subscriptions -- --dry-run
docker exec -w /app earthquake-hub-backend-dev npm run db:pg:copy-subscriptions
```

What it does:

- Rows are matched by `legacy_mongo_id` (the MongoDB `_id`), so it's **safe to run again**: nothing is duplicated, and MongoDB changes since the last run are copied.
- A row changed in PostgreSQL since it was copied (newer `updated_at`) is **kept**, so a re-run after the switch never overwrites newer data.
- Skipped and listed by `_id`: documents that can't be stored (no endpoint, missing keys, unknown status), and endpoints PostgreSQL already has under another row (the browser subscribed again after the switch).
- Ends by checking that every copyable subscription has its row and the counts add up. Exit code `0` = done, `1` = validation failed, `2` = error.

Example output:

```
MongoDB subscriptions: 42
  inserted: 40
  updated: 0
  kept (changed in PostgreSQL since copied): 0
  skipped, endpoint already in PostgreSQL under another row: 0
  skipped, can't be stored: 2
    6512...: missing keys
    6513...: no endpoint
Validation passed: all 40 copyable subscriptions are in PostgreSQL.
```

Job locks aren't copied: a lock only lives as long as a job run, so a fresh table is fine.

### Copying significant earthquakes

[`scripts/copy-significant-eqs-to-postgres.js`](scripts/copy-significant-eqs-to-postgres.js) copies MongoDB `significant-eqs` into `significant_eqs`. Run it inside the backend container, like the subscriptions copy:

```sh
docker exec -w /app earthquake-hub-backend-dev npm run db:pg:copy-significant-eqs -- --dry-run
docker exec -w /app earthquake-hub-backend-dev npm run db:pg:copy-significant-eqs
```

- Matched by `legacy_mongo_id` and **safe to run again**, with the same rule as above: a row edited in PostgreSQL since it was copied is kept.
- Each record is checked against [the table's rules](#significant_eqs) first. A record that breaks one is **not copied**: it's listed with its `_id`, title and every reason, so you can fix it in MongoDB (e.g. in Compass) and run the copy again. Numbers stored as text (`"6.9"`) are accepted, as Mongoose would have cast them.
- Ends by checking that every valid record has its row and the counts add up. Exit code `0` = done (skipped records alone don't fail it), `1` = validation failed, `2` = error.

Example output:

```
MongoDB significant earthquakes: 12
  inserted: 11
  updated: 0
  kept (changed in PostgreSQL since copied): 0
  skipped, breaks the table's rules (fix in MongoDB, then run again): 1
    6512... "Magnitude 6.1, Surigao": missing magnitude; latitude 500 not between -90 and 90
Validation passed: all 11 valid records are in PostgreSQL.
```

**Old links keep working.** The API returns a copied record's MongoDB id as `_id`, and `POST /significant-eqs` finds a record by that old id as well as by its new uuid, so links like `/significant-eq-info?id=<old id>` still open the right page. The list keeps the order the records were added in, as on MongoDB.

---

## 7. Tables

| Table | Replaces (MongoDB) | Migration | Copy script |
|---|---|---|---|
| `job_locks` | `joblocks` | `20261022000100_create_job_locks.js` | none (temporary data) |
| `push_subscriptions` | `subscriptions` | `20261022000200_create_push_subscriptions.js` | `db:pg:copy-subscriptions` |
| `significant_eqs` | `significant-eqs` | `20261023000000_create_significant_eqs.js` | `db:pg:copy-significant-eqs` |
| `accounts` | `accounts` | `20261026000000_create_accounts.js` | coming next (Step 2) |
| `devices` | `devices` (and `accounts.devices[]`) | `20261026000100_create_devices.js` | coming next (Step 2) |
| `device_releases` | `accounts.releasedDevices[]` | `20261026000200_create_device_releases.js` | coming next (Step 2) |

`accounts`, `devices` and `device_releases` exist but nothing reads or writes them yet: accounts and devices still run on MongoDB until the Step 2 switch.

Every table with an `updated_at` column keeps it current with the `set_updated_at()` trigger (migration `20261022000000`). An update that sets `updated_at` itself keeps that value; the copy scripts rely on this to preserve MongoDB's timestamps.

### `job_locks`

A mutex for background jobs (e.g. the nightly catalog enrichment), so only one backend instance runs a job at a time.

| Column | Type | Notes |
|---|---|---|
| `name` | `text`, primary key | e.g. `additional-information-enrichment` |
| `owner` | `text` | `hostname:pid` of the process holding it |
| `expires_at` | `timestamptz`, indexed | the lock counts as free after this |
| `updated_at` | `timestamptz` | |

Taking a lock is one atomic statement: `INSERT … ON CONFLICT (name) DO UPDATE … WHERE` the lock has expired or already belongs to the caller. If two processes race, one gets the row and the other gets nothing back, so only one runs the job.

### `push_subscriptions`

One browser subscribed to web-push earthquake notifications.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, primary key | `uuidv7()` |
| `legacy_mongo_id` | `char(24)`, unique | MongoDB `_id` of a copied row; null for rows created in PostgreSQL |
| `account_id` | `uuid` | optional; foreign key added when accounts move (Step 2) |
| `endpoint` | `text`, unique | subscribing again with the same endpoint updates the row |
| `expiration_time` | `bigint` | epoch ms, from the browser |
| `key_auth`, `key_p256dh` | `text` | push encryption keys |
| `status` | `subscription_status` enum | `active` or `invalid` |
| `last_seen_at` | `timestamptz` | last (re-)subscribe |
| `last_delivered_at` | `timestamptz` | |
| `last_failure_at`, `last_failure_code` | `timestamptz`, `int` | last failed push and its HTTP status |
| `consecutive_failures` | `int` | reset by a successful push or re-subscribe |
| `invalidated_at`, `cleanup_after` | `timestamptz` | when it went invalid; deleted after `cleanup_after` |
| `source_sw_script`, `client_user_agent`, `client_app_version`, `client_time` | | what the browser reported |
| `created_at`, `updated_at` | `timestamptz` | |

Indexes: `(status, last_seen_at)` and `cleanup_after`.

### `significant_eqs`

Hand-curated notable earthquakes, shown on the significant earthquakes page. The API returns them in the same JSON as before: column names in brackets are the API field names.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, primary key | `uuidv7()`; the API's `_id` for rows created in PostgreSQL |
| `legacy_mongo_id` | `char(24)`, unique | MongoDB `_id` of a copied row; the API's `_id` for those rows |
| `event_id` | `uuid` | optional link to the detected event; foreign key added when events move (Step 3) |
| `title` | `text`, required | [`title`] |
| `magnitude` | `double precision`, required | [`magnitude`] |
| `depth_km` | `double precision` | [`depth`] |
| `latitude`, `longitude` | `double precision`, required | [`latitude`, `longitude`] |
| `location` | `geography(Point, 4326)` | **generated** from latitude/longitude, GiST index; not in the API |
| `location_text` | `text` | place name [`location`] |
| `event_time` | `timestamptz`, required, indexed | [`eventTime`] |
| `event_summary` | `text` | HTML [`eventSummary`] |
| `instrument_recordings` | `jsonb` list, default `[]` | station codes [`instrumentRecordings`] |
| `reference_links` | `jsonb` list, default `[]` | URLs [`references`]; renamed because `REFERENCES` is reserved in SQL |
| `created_at`, `updated_at` | `timestamptz` | copied rows: the time the MongoDB record was created |

**Validation rules.** MongoDB accepted any document in this collection. The table rejects, on every write:

| Rule | Constraint |
|---|---|
| `title`, `magnitude`, `latitude`, `longitude`, `event_time` must be present | `NOT NULL` |
| `title` not blank | `significant_eqs_title_not_blank` |
| `latitude` between -90 and 90 | `significant_eqs_latitude_range` |
| `longitude` between -180 and 180 | `significant_eqs_longitude_range` |
| `magnitude` between -2 and 10 | `significant_eqs_magnitude_range` |
| `depth_km` between -10 and 1000 (when set) | `significant_eqs_depth_range` |
| `instrument_recordings` and `reference_links` are lists | `significant_eqs_recordings_is_array`, `significant_eqs_references_is_array` |

An optional field that's empty is left out of the API response, as it was when a MongoDB document lacked it.

### `accounts`

One user: a citizen (who may own sensors), a barangay, or an admin.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, primary key | `uuidv7()` |
| `legacy_mongo_id` | `char(24)`, unique | MongoDB `_id` of a copied row |
| `email`, `username` | `citext`, required, unique | compared **without regard to case**: `Juan@x.org` and `juan@x.org` are the same account |
| `password_hash` | `text`, required | bcrypt; never returned by the API |
| `roles` | `account_role[]` | each one of `citizen`, `sensor`, `brgy`, `admin` |
| `is_approved` | `boolean`, default false | brgy accounts need admin approval |
| `password_policy_version`, `password_updated_at` | `int` (default 1), `timestamptz` | |
| `password_reset_token_id`, `password_reset_issued_at`, `password_reset_used_at` | `text`, `timestamptz` | single-use reset links |
| `ringserver_url`, `ringserver_port` | `text` (unique), `int` | brgy accounts only |
| `rshake_email_enabled`, `alert_prefs_updated_at` | `boolean` (default false), `timestamptz` | device alert emails |
| `created_at`, `updated_at` | `timestamptz` | |

Rules: email and username required, not blank, and unique in any case; one brgy per ringserver URL; ringserver port 1–65535; roles limited to the four above.

Usernames are case-sensitive in MongoDB, so `Juan` and `juan` can both exist there. Such pairs can't both be copied: the copy script (next Step 2 task) will report them for the team to resolve.

### `devices`

One Raspberry Shake sensor. Ownership moves here from `accounts.devices[]`.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, primary key | `uuidv7()` |
| `legacy_mongo_id` | `char(24)`, unique | MongoDB `_id` of a copied row |
| `owner_account_id` | `uuid` → `accounts` | at most one owner; **null when the owner is deleted** (`ON DELETE SET NULL`) |
| `network`, `station` | `varchar(8)`, `varchar(16)`, required | unique **together** (e.g. `AM` + `R3B2D`) |
| `description` | `text` | |
| `stream_id`, `mac_address` | `text`, unique | null = not linked yet; empty strings aren't allowed |
| `latitude`, `longitude`, `elevation_m` | `double precision`, required | coordinates must be valid |
| `location` | `geography(Point, 4326)` | **generated** from latitude/longitude, GiST index |
| `activity`, `activity_toggled_at` | `device_activity` (default `inactive`), `timestamptz` | `active`, `inactive` or `unlinked` |
| `rshake_alert_credential_hash`, `rshake_alert_credential_issued_at` | `text`, `timestamptz` | never returned by the API |
| `created_at`, `updated_at` | `timestamptz` | |

Rules: one device per network + station; a stream ID or MAC address belongs to one device; latitude −90…90 and longitude −180…180; the owner must be an existing account.

### `device_releases`

One row each time an account unlinked a device, with a snapshot of the device at that moment (replaces `accounts.releasedDevices[]`).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, primary key | |
| `legacy_mongo_id` | `char(24)`, unique | `_id` of the MongoDB `releasedDevices[]` entry (lets the copy be re-run) |
| `account_id` | `uuid` → `accounts`, required | who released it; **deleted with the account** (`ON DELETE CASCADE`) |
| `device_id` | `uuid` → `devices` | **null if the device is later deleted** (`ON DELETE SET NULL`); the snapshot stays |
| `network`, `station`, `stream_id`, `mac_address`, `description`, `latitude`, `longitude`, `elevation_m` | | the device as it was |
| `reason`, `released_at` | `text` (default `unlink`), `timestamptz` | |

Index: `(account_id, released_at)`, for an account's history in order.

### Scheduled deletes (instead of TTL indexes)

PostgreSQL has no TTL indexes. The cleanup scheduler (`src/services/subscriptionCleanup.service.js`, every `NOTIF_CLEANUP_INTERVAL_MIN`, default 60 minutes) deletes expired job locks and invalid push subscriptions past `cleanup_after`, and logs the counts:

```
[notif-cleanup] expired=0 stale=0 removed=1 expiredLocks=0
```

---

## 8. Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `required variable PG_USER is missing` (or another `PG_*`) | Key missing from `.env` | Add the keys from [1.1](#11-add-the-postgresql-keys-to-your-env) |
| `Bind for 127.0.0.1:5432 failed: port is already allocated` | A local PostgreSQL (or another container) uses 5432 | Set `PG_PORT=5433` in `.env`, then `docker compose up -d` |
| `password authentication failed for user "ehub"` | Volume was created before you set or changed the password, so the user doesn't match `.env` | [Start over](#starting-over), or change it as the same user: `docker exec earthquake-hub-postgres psql -U ehub -d earthquake_hub -c "ALTER USER ehub PASSWORD '<new>'"` |
| `database "earthquake_hub" does not exist` | `PG_DATABASE` changed after the volume was created | [Start over](#starting-over), or `docker exec earthquake-hub-postgres createdb -U ehub <name>` |
| `connect ECONNREFUSED 127.0.0.1:5432` when running migrations | Container not running, or `PG_PORT` doesn't match the published port | `docker compose up -d`, then `docker compose ps` to see the port |
| `getaddrinfo ENOTFOUND postgres` when running migrations | `PG_HOST=postgres` in `.env` | Set `PG_HOST=localhost` in `.env`; `postgres` only resolves inside Docker |
| Backend logs `In PostgreSQL setup... ` with an error | PostgreSQL unreachable from the backend container | `docker compose ps`; check `docker logs earthquake-hub-postgres` |
| `permission denied to create extension "postgis"` | Migrations run as a non-superuser | Run them as the `PG_USER` the container created (a superuser) |
| `npm run test:integration` fails with `Could not find a working container runtime strategy` | Docker isn't running (or you ran it inside a container) | Start Docker Desktop and run it on your machine |
| `earthquake-hub-postgres` never becomes healthy | Usually an init error on first start | `docker logs earthquake-hub-postgres`; if the volume is half-initialized, [start over](#starting-over) |
| `relation "push_subscriptions" does not exist` (or `job_locks`) | The area is switched to PostgreSQL but the migrations haven't run | `npm run db:pg:migrate`, or set the area back to `mongodb` |
| Backend exits with `JOB_LOCKS_DB must be "mongodb" or "postgres"` | Typo in an area setting | Fix the value in `.env` |
| Subscriptions missing after switching to PostgreSQL | The copy script wasn't run | Run [the copy](#copying-push-subscriptions); it skips anything already there |
| Significant earthquakes page empty, or a record missing, after switching | The copy wasn't run, or it skipped the record | Run [the copy](#copying-significant-earthquakes) and check its "skipped" list; fix those records in MongoDB and run it again |
| `new row for relation "significant_eqs" violates check constraint ...` | A write broke one of [the table's rules](#significant_eqs) | Fix the value named in the constraint |
