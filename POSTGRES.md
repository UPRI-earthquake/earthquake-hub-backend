# PostgreSQL: Local Setup, Migrations & GUI Clients

The backend runs on **PostgreSQL 18 with PostGIS 3.6**. It moved there from MongoDB one area at a time: job locks, accounts and devices, earthquakes, and comments and points ([section 6](#6-moving-an-area-the-per-area-switch), [section 7](#7-tables)). Significant earthquakes were deprecated and removed (migration `20261105000000`).

**Dev runs without MongoDB** (Phase 4): `docker-compose.yml` has no `mongodb` service, the backend doesn't connect to MongoDB, and every area is on PostgreSQL. The only copy of the old dev MongoDB data is the final dump ([section 8](#8-the-final-mongodb-dump)). Going back to MongoDB now means restoring that dump into a MongoDB container ([Going back to MongoDB](#going-back-to-mongodb)).

Queries and schema changes go through [Knex](https://knexjs.org): `src/db/knex.js` holds the connection pool, `src/db/migrations/` the versioned schema changes.

1. [First-time local setup](#1-first-time-local-setup)
2. [Running migrations](#2-running-migrations)
3. [Connecting with a GUI client](#3-connecting-with-a-gui-client)
4. [Integration tests](#4-integration-tests)
5. [Repositories and golden files](#5-repositories-and-golden-files)
6. [Moving an area: the per-area switch](#6-moving-an-area-the-per-area-switch)
7. [Tables](#7-tables)
8. [The final MongoDB dump](#8-the-final-mongodb-dump)
9. [Troubleshooting](#9-troubleshooting)

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
docker compose ps        # earthquake-hub-postgres should show (healthy)
```

Docker Compose creates the `earthquake-hub-postgres-data` volume on first start. The backend and PostgreSQL are the only services: MongoDB isn't needed, and `.env` needs no `MONGO_*` keys.

On the first start of an **empty** volume, PostgreSQL creates the `PG_USER` user (a superuser inside this container) and the `PG_DATABASE` database. The image's own PostGIS init script is skipped on purpose, so the database starts with no extensions: the first migration adds them.

The backend waits until PostgreSQL is healthy, then logs:

```
Connected to PostgreSQL 18.6 (...) at postgres:5432/earthquake_hub
```

It starts on an empty, unmigrated database, but requests that read or write data fail until you apply the migrations (1.3). If PostgreSQL can't be reached, it logs the error and keeps running, and those requests fail until it's back.

### 1.3 Apply the migrations

```sh
npm run db:pg:migrate
```

See [section 2](#2-running-migrations). The migrations create the tables, not the data: a new database is empty.

### 1.4 Load test data

```sh
npm run db:pg:seed
```

[`scripts/seed-dev-data.js`](scripts/seed-dev-data.js) fills the database with data to develop and test against:

| Data | Details |
|---|---|
| 906 earthquakes (2021–2026) | Dev's events, with their PHIVOLCS/USGS matches, enrichment status and station lists. Public earthquake data only, from [`scripts/seed-data/dev-earthquakes.json.gz`](scripts/seed-data/dev-earthquakes.json.gz). |
| Test accounts | `qa_citizen_1`, `qa_citizen_2`, `qa_sensor_owner` (citizens) and `qa_brgy` (an approved brgy). Password: `Qa-Password-2026!` |
| 17 test sensors | One per station code the earthquakes list, placed in Philippine cities. Three belong to `qa_sensor_owner`, and `qa_brgy` forwards two of those; the rest aren't linked. |

- **No personal data:** no real account, email, password or sensor location is included, so the data can live in the repo. The earthquakes show what dev shows: for example, the same 16 significant earthquakes.
- **It only adds what's missing:** accounts by username, sensors by network and station, earthquakes by `publicID`. It never changes or deletes anything, so it's safe on a database that already has data, and to run again. On one that does, it adds just the test accounts (and the sensors, if their station codes are free).
- **It refuses to run with `NODE_ENV=production`.**

If you have the final MongoDB dump, you can load the old dev data, accounts included, instead: see [Loading it into PostgreSQL](#loading-it-into-postgresql).

### 1.5 Check it works

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
npm run db:pg:seed
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

A MongoDB fixture, [`__tests__/fixtures/mongo.fixture.js`](__tests__/fixtures/mongo.fixture.js), does the same for MongoDB. Some tests still use it although dev has no MongoDB: the golden tests seed their data there and copy it with the copy scripts, the copy tests check those scripts, and the repository tests also run the MongoDB versions ([section 5](#5-repositories-and-golden-files)).

---

## 5. Repositories and golden files

Each area moved to PostgreSQL behind a **repository**: a module in `src/repositories/` that holds all of that area's database calls. Services call the repository, never a Mongoose model or Knex directly, so moving an area meant writing a PostgreSQL version of its repository and nothing above it.

Every area has both versions, in `src/repositories/mongodb/` and `src/repositories/postgres/`, and `src/repositories/<area>.repo.js` loads the PostgreSQL one: its setting only accepts `postgres` ([section 6](#6-moving-an-area-the-per-area-switch)). The backend never loads the MongoDB versions now; only the repository tests still run them.

| Area | Repository | Setting | Database |
|---|---|---|---|
| Job locks | `src/repositories/jobLocks.repo.js` | `JOB_LOCKS_DB` | PostgreSQL |
| Accounts | `src/repositories/accounts.repo.js` | `PEOPLE_AND_SENSORS_DB` | PostgreSQL |
| Devices (and each account's device list and release history) | `src/repositories/devices.repo.js` | `PEOPLE_AND_SENSORS_DB` | PostgreSQL |
| Earthquake events (with their stations, catalog matches and enrichment status) | `src/repositories/events.repo.js` | `EARTHQUAKES_DB` | PostgreSQL |
| Comments (with their helpful marks and issue reports) | `src/repositories/comments.repo.js` | `COMMUNITY_DB` | PostgreSQL |
| Contribution points | `src/repositories/contributions.repo.js` | `COMMUNITY_DB` | PostgreSQL |

Accounts and devices share **one** setting, `PEOPLE_AND_SENSORS_DB`, which also picks the transaction helper (`src/repositories/transactions.js`): they reference each other, so they always run on the same database. In the PostgreSQL versions (`src/repositories/postgres/`):

- email and username lookups ignore case through `citext`, with no lowercasing in code; usernames therefore become case-insensitive, as emails already were
- a citizen's device list is the devices it owns (`devices.owner_account_id`); a brgy's is `brgy_forwarded_devices`
- linking a device (the device, the account's list, clearing its release history) and releasing one (taking it out of the list, writing its `device_releases` row) each run in one transaction, so a failed step changes nothing

Repositories return plain objects with an `id`, never database documents, and services change data only through repository functions, so a PostgreSQL version can stand in unchanged. Two shared helpers keep the rest database-neutral:

- `src/repositories/errors.js`: a write that breaks a unique rule throws `DuplicateKeyError` (with the colliding `fields`), whichever database rejected it.
- `src/repositories/transactions.js`: `withTransaction(async (tx) => { ... })` runs writes together; repository functions join it when passed `{ tx }`.

Comments come back with their helpful marks (`helpfulAccountIds`) and issue reports (`issueReports`) as lists, and event and account ids as MongoDB-style strings, so the PostgreSQL version keeps marks and reports in their own tables without changing `comments.service.js`. An account marks a comment helpful once and has one issue report per comment (a second replaces the first); a points entry is stored once per `dedupeKey`, and a repeated action leaves the first one as it was. Posting a report, marking one helpful and reporting an issue each write the comment change and its points in **one transaction** (`src/repositories/communityTransactions.js`), so a failed points write leaves no half-done mark.

Two kinds of integration tests check that a move changes nothing:

- **Repository tests** (`__tests__/<area>.repo.integration.test.js`) describe what each repository function does with real data. They run the same cases against the MongoDB and the PostgreSQL version.
- **Golden files** (`__tests__/golden/*.json`) are API responses recorded while the areas ran on MongoDB: status, key headers (including `Set-Cookie`) and body. The `*.golden.postgres.integration.test.js` files (`peopleAndSensors` for accounts and devices, `earthquakes`, and `community` for comments and points) run the real app with every area on PostgreSQL against seeded data, and compare each response with its recording. `earthquakes` fakes GeoServe, FDSN, PHIVOLCS and USGS (`__tests__/fixtures/earthquakesExternal.js`). No endpoint returns points, so `community` also records the points stored after each request (or checks them unchanged). The data is seeded in MongoDB and copied with the real copy scripts, then removed from MongoDB, so the responses also show that copied data keeps its ids. Seeded records hold only what both databases can represent (PostgreSQL can't tell a missing field from a null one), e.g. an ingested event's legacy fields are null, as ingest writes them. The runs with areas on MongoDB, and the community rollback run, were removed with MongoDB in Phase 4.

Values that change on every run are made stable before comparing (see `__tests__/fixtures/golden.js`): a JWT is recorded as its decoded claims (`iat` as `<now>`, `exp` as `<now + Ns>`), timestamps from the current run as `<now>`, and random secrets and newly generated ids as placeholders. Seeded data uses fixed past dates, which are recorded as they are.

Integration tests never follow your `.env`'s area settings: `__tests__/fixtures/integrationEnv.js` (a `setupFilesAfterEnv` entry, so the `--setupFiles` of `npm run test:integration` can't replace it) empties every area setting before each test file, so each area takes its default, `postgres`. The app's dotenv call never overrides a variable that's already set, even an empty one.

Re-record golden files only when a response is meant to change, and review the diff in the PR:

```sh
UPDATE_GOLDEN=1 npm run test:integration
# PowerShell: $env:UPDATE_GOLDEN=1; npm run test:integration; Remove-Item Env:UPDATE_GOLDEN
```

---

## 6. Moving an area: the per-area switch

**Done in dev:** every area moved to PostgreSQL (Steps 1–4), and since Phase 4 the switch only accepts `postgres`. This section is the record of how the areas moved. The copy scripts in it are still how MongoDB data gets into PostgreSQL.

Each area has a setting that picked its database during the move:

```env
JOB_LOCKS_DB=postgres            # job locks
PEOPLE_AND_SENSORS_DB=postgres   # accounts and devices together
EARTHQUAKES_DB=postgres          # earthquake events
COMMUNITY_DB=postgres            # comments and points
```

Unset now means `postgres`, and `postgres` is the only value accepted (`src/db/areaDatabase.js`): anything else, `mongodb` included, stops the backend at startup with `JOB_LOCKS_DB must be "postgres" (got "mongodb")`. `.env.example` sets all four to `postgres`; leaving them out of `.env` has the same effect.

During the move, unset meant `mongodb`, so production stayed on MongoDB. An area could only move after the areas its tables point to (`dependsOn` in `src/db/areaDatabase.js`): earthquakes after accounts and devices, since event stations point to devices; comments and points after both, since they point to accounts and events. The backend logs its choice on startup:

```
[db] accounts: postgres (PEOPLE_AND_SENSORS_DB)
[db] devices: postgres (PEOPLE_AND_SENSORS_DB)
[db] job locks: postgres (JOB_LOCKS_DB)
[db] earthquake events: postgres (EARTHQUAKES_DB)
[db] comments: postgres (COMMUNITY_DB)
[db] contribution points: postgres (COMMUNITY_DB)
[db] MongoDB: not used (every area is on PostgreSQL)
```

Since Phase 4 the backend doesn't connect to MongoDB at all (the last line above), and loads no Mongoose model. Before that, with every area on PostgreSQL (dev since Step 4), it connected but sent MongoDB nothing: the profiler showed no operations from the backend ([section 8](#how-it-was-checked)). An area was never written to both databases.

### Ids the API shows: MongoDB-style

**The rule:** whatever id a client sees stays the MongoDB-style id (`legacy_mongo_id`), never the PostgreSQL uuid. The uuid is used only inside PostgreSQL (keys and joins). Every row a client can name has one: a copied row keeps its old `_id`, and an account, device or event created in PostgreSQL gets a new ObjectId. Repositories return it as `legacyId` (or as `_id`, `eventId`, `accountId` in the API's shapes).

Why: until Step 4, comments and contributions stayed on MongoDB and stored account and event ids as ObjectIds; and clients (the frontend, sensors, open sessions) already hold account, device and event ids from earlier responses.

**After Step 4 (decided: keep them).** Comments and points are in PostgreSQL now, but session tokens and responses keep the MongoDB-style ids: the comments and points repositories take an account's MongoDB-style id (from the session token) and an event's (from `GET /comments?eventId=`) and find the row through `legacy_mongo_id` (`src/repositories/postgres/legacyIds.js`), and admin responses return `eventId` / `accountId` the same way. Sessions from before any switch keep working. Dropping the MongoDB-style ids would be a separate change, made once nothing depends on them (every client and open session would have to move to the uuids at once). So:

- **Session tokens carry the account's `legacyId`**, so comments keep their author id, and new users can comment too.
- **Sessions from before the switch keep working:** tokens are checked by signature, accounts are looked up by username, and the `accountId` inside the token is still the account's `legacy_mongo_id`.
- **An event's `_id` is its `legacy_mongo_id`:** a copied event keeps its old `_id`, and an event SeisComP sends after the switch gets a new ObjectId. Comments and contributions store that id; `comments.service.js` finds the event by it through the events repository (`findRefById`), so comments from before the switch still list under their event.
- **Device ids in responses are the device's `legacyId`:** `deviceId` in alert credentials (`/device/alert-credential`, `/device/link`) and in `releasedDevices[]`. A released device keeps its id in `device_releases.device_legacy_mongo_id`, so the history still shows it after the device is deleted, as MongoDB did.

- **Comments and points name accounts and events by those ids:** a copied comment keeps its event and author, and admin responses show `eventId`, `eventPublicID` (the event's `public_id`) and `accountId` as before. A comment's own `commentId` was always a UUID and stays the same.

`__tests__/community.switch.integration.test.js` checks a session from before the switch posting and marking comments on PostgreSQL (and that the backend sends MongoDB nothing meanwhile), and the golden files check the ids in every recorded response. The accounts and earthquakes switch tests ran areas half on MongoDB, and were removed in Phase 4.

### Switching an area to PostgreSQL

Dev went through these steps for each area. Step 4 can't be repeated now, since every area is already on PostgreSQL, but step 6's flows still check a PostgreSQL-only backend.

1. Apply the migrations: `npm run db:pg:migrate`.
2. Save a few of the area's responses to compare later (e.g. `curl -s localhost:5000/device/all > before.json`).
3. Copy the area's data, if it has a copy script (see below). Do a dry run first. The copy must end with `Validation passed`.
4. Set the area's setting to `postgres` in `.env` and restart the backend: `docker restart earthquake-hub-backend-dev`.
5. Check the `[db]` line in `docker logs earthquake-hub-backend-dev`.
6. Verify: the saved responses come back the same, and the area's main flows work. For accounts and devices: register a throwaway account, sign in by email and by username in another case, open my devices, delete the account. For earthquakes: compare `GET /eq-events` over all time and a few event pages, field by field per `publicID` (the list order can differ, since place names are filled in as GeoServe answers); post a test event to `/messaging/restricted/new-event` (and an older update of it, which must be dropped), comment on it, then delete the comment from `comments` and the event from `events`. For comments and points: register two throwaway accounts; post a report as one; as the other, list it, mark it helpful twice, unmark and mark again, and report an issue twice; check `contribution_events` has each action once; as an admin, reject the report, then delete it; delete both accounts (their points go with them).
7. Optionally, run the MongoDB profiler (`db.setProfilingLevel(2)`) while you do step 6: the moved area's collection should show no operations from the backend (since Step 4, no collection at all). Dev has no MongoDB now, so this no longer applies.

The step 6 flows were last run on 2026-11-06, against dev with no MongoDB: all passed. They found one problem, new database connections stalling after a full event list, since fixed ([Troubleshooting](#9-troubleshooting)).

### Going back to MongoDB

Going back is no longer a setting change: dev has no MongoDB, and the backend no longer accepts `mongodb`. It means:

1. Check out a backend from before Phase 4: `feat/postgres-migration` at `d94371c`. Its `docker-compose.yml` still has the `mongodb` service, and its area settings accept `mongodb` (unset means `mongodb` there).
2. Set it up as [MONGODB.md](MONGODB.md) describes: the `MONGO_*` keys in `.env`, and `docker volume create earthquake-hub-mongodb-data` (the old volume was deleted).
3. Start it, and restore the final dump into its `mongodb` container with the app user and `--drop` ([section 8](#going-back-to-mongodb-with-it)).
4. Remove the area settings from `.env` (or set them to `mongodb`), and restart the backend.

The dump holds the data as of 2026-11-06 02:49 UTC. Anything written to PostgreSQL since then isn't in it, and no script copies PostgreSQL back to MongoDB. What that means for each area follows: read *the switch* as the dump time.

**Accounts and devices** (`PEOPLE_AND_SENSORS_DB`) need more care, because people change them through the app:

- **Lost on rollback** (still in PostgreSQL, not in MongoDB): accounts registered after the switch, and changes since the switch to passwords, emails, usernames, alert settings, device links and unlinks, and brgy forwarding. List them before rolling back: `SELECT legacy_mongo_id, created_at, updated_at FROM accounts WHERE updated_at > '<switch time>'` (and the same for `devices`).
- **Sessions:** a copied account's token carries its old `_id`, so it keeps working on MongoDB. An account registered after the switch doesn't exist in MongoDB, so its sessions stop working and it has to register again.
- **Device activity** is stale in MongoDB until each station's next status update, which corrects it.
- **Moving forward again:** run the copy again before switching back. Rows changed in PostgreSQL since the first copy are kept, so changes made on MongoDB during the rollback to those same rows are not copied: check the copy's `kept` counts.

**Earthquakes** (`EARTHQUAKES_DB`; set it back before `PEOPLE_AND_SENSORS_DB`, or the backend won't start):

- **Lost on rollback** (still in PostgreSQL, not in MongoDB): events SeisComP sent after the switch, and changes since the switch to place names, summaries, station checks and catalog matches. List them: `SELECT public_id, legacy_mongo_id, updated_at FROM events WHERE updated_at > '<switch time>'`.
- **Getting those events back into MongoDB (resending them):** the SeisComP proxy (`earthquake-hub-commons/seiscomp-scripts/event_messaging_proxy.py`) forwards live messages only, so replay them from PostgreSQL through the same endpoint, after setting `EARTHQUAKES_DB=mongodb` and restarting:

  ```sh
  docker exec earthquake-hub-postgres psql -U ehub -d earthquake_hub -tAc "
    SELECT json_build_object('publicID', public_id, 'OT', origin_time, 'latitude_value', latitude,
      'longitude_value', longitude, 'depth_value', depth_km, 'magnitude_value', magnitude,
      'eventType', coalesce(seiscomp_type, 'UPDATE'), 'method', 'replay', 'text', coalesce(region_text, ''),
      'last_modification', coalesce(last_modification, updated_at))
    FROM events WHERE updated_at > '<switch time>' ORDER BY origin_time" |
  while read -r body; do
    curl -s -X POST localhost:5000/messaging/restricted/new-event -H 'Content-Type: application/json' -d "$body"; echo
  done
  ```

  Each one is ingested as SeisComP would send it: an event MongoDB doesn't have is created (with a new `_id`, its nearest stations, a station check and pending enrichment), and one it has is updated if the replayed `last_modification` is newer. Place names, summaries and catalog matches made in PostgreSQL aren't replayed; they're worked out again. **Replaying also sends what a live event sends:** an SSE message to every open map, so don't replay against an environment with real users watching. A SeisComP admin can resend events from SeisComP itself instead (`scxmldump` the events, then `scdispatch` them), which the proxy forwards like any update.
- **Comments on events created after the switch** keep those events' new ObjectIds. If SeisComP sends such an event again on MongoDB, it gets another `_id`, so those comments no longer list under it; they still list under the `publicID` (comments store `eventPublicID` too).
- **Moving forward again:** run `db:pg:copy-earthquakes` again before switching back. Events changed in PostgreSQL since the first copy are kept with their rows.

The differences between the two databases that stay after a switch (none of them read by the frontend) are listed in [Copying earthquakes](#copying-earthquakes).

**Comments and points** (`COMMUNITY_DB`; set it back first, before `EARTHQUAKES_DB` and `PEOPLE_AND_SENSORS_DB`, or the backend won't start):

- **Lost on rollback** (still in PostgreSQL, not in MongoDB): reports posted after the switch, and the helpful marks, issue reports, moderation and points since then. List them before rolling back:

  ```sql
  SELECT c.comment_id, c.username, c.status, c.created_at, c.updated_at, e.public_id
  FROM comments c JOIN events e ON e.id = c.event_id
  WHERE c.updated_at > '<switch time>' OR c.legacy_mongo_id IS NULL;

  SELECT ce.dedupe_key, a.username, ce.action_type, ce.points, ce.created_at
  FROM contribution_events ce JOIN accounts a ON a.id = ce.account_id
  WHERE ce.legacy_mongo_id IS NULL;
  ```

  A comment's `updated_at` moves with every mark or report on it, so the first query also finds copied reports that were marked, flagged or moderated since the switch. Rows with no `legacy_mongo_id` were created in PostgreSQL.
- **Comments and points stay where they were written:** on MongoDB, the copied ones reappear as they were at the switch; the rest exist only in PostgreSQL. Their ids are the same MongoDB-style ids on both sides, so nothing else has to change.
- **Moving forward again:** run `db:pg:copy-community` again before switching back. Comments changed in PostgreSQL since the first copy are kept with their marks and reports; points entries already there are never rewritten, and a `dedupeKey` already counted in PostgreSQL isn't counted again.

**What the API shows differently on PostgreSQL** (none of it in the recorded responses): a comment whose author's account was deleted shows `accountId: null` to admins, where MongoDB kept the deleted account's id; and a session whose account no longer exists can still post (unlinked, under its username) but can't mark, flag or earn points, which need a real account.

On dev nothing is live, so a rollback only loses test data.

### Job locks

Job locks aren't copied: a lock only lives as long as a job run, so a fresh table is fine.

### Copying accounts and devices

The copy scripts read MongoDB through the `MONGO_*` keys. Dev has no MongoDB now, so to run one, first start a MongoDB with the data, such as the final dump ([Loading it into PostgreSQL](#loading-it-into-postgresql)).

[`scripts/copy-people-and-sensors-to-postgres.js`](scripts/copy-people-and-sensors-to-postgres.js) copies MongoDB accounts, devices, each account's released-device history and the brgy forwarding links into `accounts`, `devices`, `device_releases` and `brgy_forwarded_devices`. Run `npm run db:find-duplicates` first, then:

```sh
docker exec -w /app earthquake-hub-backend-dev npm run db:pg:copy-people-and-sensors -- --dry-run
docker exec -w /app earthquake-hub-backend-dev npm run db:pg:copy-people-and-sensors
```

Accounts hold personal data. Run it against real data only on the server or a sanitized dump, never a production copy on a laptop.

What it does, in order:

1. **Accounts.** Skipped and listed: accounts with no email, username or password, an unknown role, or a ringserver port outside 1–65535; and accounts that would collide in PostgreSQL, meaning the same email or username **ignoring case** (`Juan` / `juan`) or the same ringserver URL as another account. All accounts in a collision are skipped, since picking one would be a guess: resolve them in MongoDB and run the copy again.
2. **Devices,** with each device's owner taken from the accounts' `devices[]` lists.
   - A brgy account's list holds devices it forwards data for, not devices it owns, so it doesn't count as ownership (see step 4).
   - A device listed by two owners, or whose owner was skipped, is copied **without an owner** and listed.
   - Skipped and listed: devices with missing or invalid coordinates, a missing elevation, or an unknown activity, and devices that would collide (same network + station, stream ID or MAC address).
   - An empty stream ID or MAC address becomes NULL ("not linked yet"); the legacy activity `streaming` becomes `active`.
3. **Released devices** of the copied accounts. History never changes, so entries already copied are left alone.
4. **Brgy forwarding links:** each brgy account's `devices[]` list becomes rows in `brgy_forwarded_devices`, in the same order, for copied brgys and devices (others are listed as skipped). Links already copied are left alone; the copy never deletes one.
5. **Validation:** every copyable account, device, released device and forwarding link has its row, and the counts add up, per table. Exit code `0` = done (skipped records alone don't fail it), `1` = validation failed, `2` = error.

Like the other copies, it's **safe to run again** (rows matched by `legacy_mongo_id`), and a row changed in PostgreSQL since it was copied is kept. Password hashes are copied as they are (bcrypt), so everyone keeps their password. The report only ever names MongoDB `_id`s: never emails, usernames or password hashes.

Example output:

```
Accounts in MongoDB: 120
  inserted: 118, updated: 0, kept (changed in PostgreSQL since copied): 0
  skipped: 2
    6512...a01: same username as 6512...a02 (ignoring case)
    6512...a02: same username as 6512...a01 (ignoring case)
Devices in MongoDB: 85
  inserted: 84, updated: 0, kept (changed in PostgreSQL since copied): 0
  skipped: 1
    6513...d07: missing coordinates
Released devices in MongoDB: 9
  inserted: 9, already copied: 0
  skipped: 0
Ownership:
  devices listed by more than one owner (copied without an owner): 0
  devices whose owner wasn't copied (copied without an owner): 1
    6513...d02: owner 6512...a01
  accounts listing a device that doesn't exist: 0
Brgy forwarding links in MongoDB: 14
  inserted: 14, already copied: 0
  skipped: 0
Validation passed: every copyable account, device, released device and forwarding link is in PostgreSQL.
```

### Copying earthquakes

[`scripts/copy-earthquakes-to-postgres.js`](scripts/copy-earthquakes-to-postgres.js) copies MongoDB `events` into `events`, and what each event embedded into `event_stations`, `event_catalog_matches` and `event_catalog_status`. Copy accounts and devices first: stations are linked to devices.

```sh
docker exec -w /app earthquake-hub-backend-dev npm run db:pg:copy-earthquakes -- --dry-run
docker exec -w /app earthquake-hub-backend-dev npm run db:pg:copy-earthquakes
```

What it does, in order:

1. **Events.** Skipped and listed: events with no `publicID`, a `publicID` another MongoDB event also has (all of them: picking one would be a guess) or that a different PostgreSQL event already has, and a `type` longer than 10 characters. Events with missing or out-of-range coordinates are copied with no `location`, and listed.
2. **Stations.** `candidateStations` (or, on older records without them, `onlineStations`) and `recordingStations`, in order, each code linked to the device with that `station`. Codes that match no device, or several, are listed and left out. `onlineStations` isn't stored but worked out when reading, so events whose stored list would come out differently are listed with both versions.
3. **Catalog matches** (`additionalInformation[]`), one per catalog: PHIVOLCS, USGS and the legacy UPRI catalog. Entries from any other catalog are listed and left out; a catalog listed twice keeps its last entry. Fields without a column, or of an unexpected type, are kept in `extra`.
4. **Enrichment status**, one row per searched catalog (PHIVOLCS, USGS), from `pendingCatalogSources`, `catalogEnrichmentStatus`/`Attempts` and the legacy `upForEnrichment`/`enrichmentAttempts`. Where a catalog has no attempt count, the legacy counter (enrichment passes over the whole event) is used. Events with no enrichment tracking at all get `pending` rows, so the nightly job picks them up after the switch.
5. **Validation:** every copyable event has its row, each copied event has all its stations, matches and status rows, and the counts add up. Exit code `0` = done (listed records alone don't fail it), `1` = validation failed, `2` = error.

An event and its rows are copied **as one unit**, matched by `legacy_mongo_id`, so it's safe to run again. An event changed in PostgreSQL since it was copied (newer `updated_at`) is kept with all its rows; otherwise its rows are rewritten from MongoDB. For this to hold after the switch, the PostgreSQL events repository moves an event's `updated_at` whenever it writes one of its rows (Step 3 - Ticket 3).

Example output (dev data, October 2026):

```
Events in MongoDB: 906
  inserted: 906, updated: 0, kept with their rows (changed in PostgreSQL since copied): 0
  skipped: 0
  copied with no location (missing or out-of-range coordinates): 0
Station entries in MongoDB: 6548
  written: 6548, kept with their event: 0
  left out, no device with that station: 0
  left out, several devices with that station: 0
  candidates taken from onlineStations (older records): 14
  onlineStations that will show differently: 2
    6a55...5dce (gfz2026nrac): stored [R1382, R257C, ...], will show [R98E0, R5B48, ...]
Catalog matches in MongoDB: 1204
  written: 1204, kept with their event: 0
  left out, unknown catalog: 0
  left out, catalog listed twice (last entry kept): 0
Enrichment status rows (one per event per searched catalog): written: 1812, kept with their event: 0
  attempts taken from the legacy enrichmentAttempts counter: 835 events
  no enrichment tracking (pending, so the nightly job picks them up): 2 events
  unknown status values (worked out from the other fields): 0
Validation passed: every copyable event and its stations, matches and status rows are in PostgreSQL.
```

The two `onlineStations` differences are the same stations in another order: the stored list is alphabetical, and the copy shows the candidates nearest first.

**What the API shows differently after the switch** (compared on dev, all 906 events; the frontend reads none of these):

| Field | Events | Why |
|---|---|---|
| `legacyImportedAt`, `legacySourcePublicID` | 847 | missing on old MongoDB records; `null` in PostgreSQL, as ingest writes them |
| `catalogEnrichmentAttempts` | 835 | `{}` in MongoDB; the per-catalog attempts the copy took from the legacy counter |
| `createdAt`, `__v` | 721, 682 | missing on old MongoDB records; always set in PostgreSQL |
| `candidateStations` | 14 | older records only had `onlineStations`, which became their candidates (`onlineStations` is unchanged) |
| `catalogEnrichmentStatus` | 2 | the events with no tracking now have pending rows |
| `onlineStations` | 2 | same stations, nearest first |

Also: `onlineStations` is worked out on read, so after an UPDATE for an event that already has recording stations it shows what the recording status implies, where MongoDB stored recording and candidate stations merged until the next station check.

Neither backend sends an event's stored point (`location`, the GeoJSON point in MongoDB and the PostGIS column in PostgreSQL): it's only for location queries. The API never sent it before this branch, and the frontend reads an event's `location` as a place name. Its title and summary fall back to it when there's no place name, so a point there showed as "[object Object]" (found by the end-to-end check, [`docs/e2e/E2E_RESULTS.md`](docs/e2e/E2E_RESULTS.md)).

### Copying comments and points

[`scripts/copy-community-to-postgres.js`](scripts/copy-community-to-postgres.js) copies MongoDB `comments` into `comments`, the lists each comment embedded into `comment_helpful_marks` and `comment_issue_reports`, and `contributionevents` (the points ledger) into `contribution_events`. Copy accounts and devices, then earthquakes, first: comments and points point to both.

```sh
docker exec -w /app earthquake-hub-backend-dev npm run db:pg:copy-community -- --dry-run
docker exec -w /app earthquake-hub-backend-dev npm run db:pg:copy-community
```

What it does, in order:

1. **Comments.** Each comment's event is found by `eventId` (the event's `legacy_mongo_id`), or else by `eventPublicID`; its account by `accountId`.
   - Skipped and listed: the event no longer exists; a `commentId` that is missing or not a UUID, that another MongoDB comment also has (all of them), or that a different PostgreSQL comment already has; neither text nor an image; text over 1000 characters.
   - Copied and listed: the account no longer exists (copied with no account, under the same username); an unknown status (copied as `pending`, hidden, as MongoDB hid it); an event found by `eventPublicID`.
   - Comments from before moderation (no status) are copied as `approved`, as MongoDB showed them. A copied comment keeps its `commentId`.
2. **Helpful marks and issue reports** (`helpfulAccountIds[]`, `issueReports[]`), one row per account. Left out and listed: entries whose account no longer exists, and reports with an unknown reason. An account listed twice is folded into one (for reports, its latest) and listed. MongoDB kept no time per mark, so a mark gets its comment's `updated_at`.
3. **Points.** Skipped and listed: no `dedupeKey`; an account that no longer exists (points belong to an account); an unknown action or target type; points that aren't a whole number; a `dedupeKey` another entry already counts (the earliest is kept), in MongoDB or in PostgreSQL. An entry whose event no longer exists is copied with no event, its `eventPublicID` kept in `metadata`, and listed. Copied entries are never rewritten: they don't change.
4. **Validation:** every copyable comment and points entry has its row, each copied comment has all its marks and reports, and every MongoDB comment, mark, report and points entry is accounted for (copied, kept, or listed with a reason). Exit code `0` = done (listed records alone don't fail it), `1` = validation failed, `2` = error.

A comment and its marks and reports are copied **as one unit**, matched by `legacy_mongo_id`, so it's safe to run again. A comment changed in PostgreSQL since it was copied (newer `updated_at`) is kept with all its marks and reports; otherwise they're rewritten from MongoDB. For this to hold after the switch, the PostgreSQL comments repository moves a comment's `updated_at` whenever it writes one of its marks or reports (Step 4 - Ticket 3), as MongoDB already did.

Dev had no comments or points when this was written (November 2026), so the copy was checked on seeded data (`__tests__/copyCommunity.integration.test.js`). Run it against real data (the server, or a sanitized dump) before production.

### Copying significant earthquake details

The old significant earthquakes (MongoDB `significant-eqs`) were picked by hand, each with a hand-written summary, instrument recordings and references. The list isn't copied: the significance score picks it now ([Significant earthquakes](#significant-earthquakes-the-significance-score)). [`scripts/copy-significant-eq-details-to-postgres.js`](scripts/copy-significant-eq-details-to-postgres.js) carries the hand-written details over to their events. Copy earthquakes first.

```sh
docker exec -w /app earthquake-hub-backend-dev npm run db:pg:copy-significant-eq-details -- --dry-run
docker exec -w /app earthquake-hub-backend-dev npm run db:pg:copy-significant-eq-details
```

What it does, in order:

1. **Matches each entry to its event:** within 1 day and 150 km of it, with the closest magnitude (then the nearest, then the lowest `public_id`). Skipped and listed: an entry with no usable latitude, longitude, magnitude or `eventTime`; one with no event near it; a second entry matching an event another entry already matched.
2. **Summary:** the entry's `eventSummary` becomes the event's `summary_override_text`, **only where the event has none**. A summary an admin wrote is kept.
3. **Recordings and references:** they become the event's `significant_eq_details` row, **only where the event has none**. Both may be lists or `"[a, b]"` strings (as the original JSON had them), and `eventTime` may be a date or `MM-DD-YYYY…` text. Station codes and links that aren't valid are left out and listed.
4. **Validation:** every matched entry's summary and details are in PostgreSQL, and every entry is accounted for (matched or listed). Exit code `0` = done, `1` = validation failed, `2` = error.

It only fills in what's missing, so it's safe to run again: a second run writes nothing. Dev had no entries (see the dump's manifest, [section 8](#the-manifest)), so it was checked on seeded data (`__tests__/copySignificantEqDetails.integration.test.js`). Run it wherever the other copy scripts run against real data.

---

## 7. Tables

| Table | Replaces (MongoDB) | Migration | Copy script |
|---|---|---|---|
| `job_locks` | `joblocks` | `20261022000100_create_job_locks.js` | none (temporary data) |
| `accounts` | `accounts` | `20261026000000_create_accounts.js` | `db:pg:copy-people-and-sensors` |
| `devices` | `devices` (and `accounts.devices[]`) | `20261026000100_create_devices.js` | `db:pg:copy-people-and-sensors` |
| `device_releases` | `accounts.releasedDevices[]` | `20261026000200_create_device_releases.js`, `20261028000000_add_device_legacy_id_to_device_releases.js` | `db:pg:copy-people-and-sensors` |
| `brgy_forwarded_devices` | brgy accounts' `devices[]` | `20261027000000_create_brgy_forwarded_devices.js` | `db:pg:copy-people-and-sensors` |
| `events` | `events` | `20261029000000_create_events.js` | `db:pg:copy-earthquakes` |
| `event_stations` | `events.candidateStations[]`, `recordingStations[]` | `20261029000100_create_event_stations.js` | `db:pg:copy-earthquakes` |
| `event_catalog_matches` | `events.additionalInformation[]` | `20261029000200_create_event_catalog_matches.js`, `20261030000000_add_position_to_event_catalog_matches.js` | `db:pg:copy-earthquakes` |
| `event_catalog_status` | `events.pendingCatalogSources`, `catalogEnrichment*`, legacy `upForEnrichment` | `20261029000300_create_event_catalog_status.js` | `db:pg:copy-earthquakes` |
| `comments` | `comments` | `20261104000000_create_comments.js` | `db:pg:copy-community` |
| `comment_helpful_marks` | `comments.helpfulAccountIds[]` | `20261104000100_create_comment_helpful_marks.js` | `db:pg:copy-community` |
| `comment_issue_reports` | `comments.issueReports[]` | `20261104000200_create_comment_issue_reports.js` | `db:pg:copy-community` |
| `contribution_events` | `contributionevents` | `20261104000300_create_contribution_events.js` | `db:pg:copy-community` |
| `significant_eq_details` | `significant-eqs` (its hand-written recordings and references) | `20261111000000_create_significant_eq_details.js` | `db:pg:copy-significant-eq-details` |

The backend uses all fourteen tables: every area is on PostgreSQL. Production, which still runs on MongoDB, doesn't use them yet. `significant_eqs` (migrations `20261023000000`, `20261029000400`), which held the hand-picked list, was dropped by `20261105000000`. Significant earthquakes came back without a stored list: the significance score picks them from `events`, and `significant_eq_details` holds only what admins add ([Significant earthquakes](#significant-earthquakes-the-significance-score)).

Every table with an `updated_at` column keeps it current with the `set_updated_at()` trigger: every update gets the current time. The copy scripts are the one exception: they set `app.preserve_updated_at = 'on'` for their transaction (in `scripts/lib/pgCopy.js`), so a copied row keeps MongoDB's `updated_at` and a later copy can still tell whether it changed in PostgreSQL (migration `20261026000300`).

### `job_locks`

A mutex for background jobs (e.g. the nightly catalog enrichment), so only one backend instance runs a job at a time.

| Column | Type | Notes |
|---|---|---|
| `name` | `text`, primary key | e.g. `additional-information-enrichment` |
| `owner` | `text` | `hostname:pid` of the process holding it |
| `expires_at` | `timestamptz`, indexed | the lock counts as free after this |
| `updated_at` | `timestamptz` | |

Taking a lock is one atomic statement: `INSERT … ON CONFLICT (name) DO UPDATE … WHERE` the lock has expired or already belongs to the caller. If two processes race, one gets the row and the other gets nothing back, so only one runs the job.

### `accounts`

One user: a citizen (who may own sensors), a barangay, or an admin.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, primary key | `uuidv7()` |
| `legacy_mongo_id` | `char(24)`, unique | MongoDB `_id` of a copied row, or a new ObjectId for an account created here: the id session tokens carry ([ids the API shows](#ids-the-api-shows-mongodb-style)) |
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

Usernames are case-sensitive in MongoDB, so `Juan` and `juan` can both exist there. Such pairs can't both be copied: the [copy](#copying-accounts-and-devices) skips and reports them for the team to resolve.

### `devices`

One Raspberry Shake sensor. Ownership moves here from `accounts.devices[]`.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, primary key | `uuidv7()` |
| `legacy_mongo_id` | `char(24)`, unique | MongoDB `_id` of a copied row, or a new ObjectId for a device created here: the `deviceId` the API returns |
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

**A device that earthquake history lists can't be deleted** (`event_stations`, `ON DELETE RESTRICT`), so `POST /device/reset-link` keeps such a device instead: it removes it from every account as before, and clears its stream ID, MAC address and alert credential (activity `unlinked`). The history keeps its station, and linking the sensor again takes the same record back, for whichever account links it: a link that finds no device with that MAC reuses a cleared device with the same network and station, after the usual check that an AM station code belongs to that MAC. A device without history is still deleted. (On MongoDB nothing refers to devices, so reset-link always deletes.)

### `device_releases`

One row each time an account unlinked a device, with a snapshot of the device at that moment (replaces `accounts.releasedDevices[]`).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, primary key | |
| `legacy_mongo_id` | `char(24)`, unique | `_id` of the MongoDB `releasedDevices[]` entry (lets the copy be re-run) |
| `account_id` | `uuid` → `accounts`, required | who released it; **deleted with the account** (`ON DELETE CASCADE`) |
| `device_id` | `uuid` → `devices` | **null if the device is later deleted** (`ON DELETE SET NULL`); the snapshot stays |
| `device_legacy_mongo_id` | `char(24)` | the device's `legacy_mongo_id`, returned as `releasedDevices[].deviceId`; **kept after the device is deleted** |
| `network`, `station`, `stream_id`, `mac_address`, `description`, `latitude`, `longitude`, `elevation_m` | | the device as it was |
| `reason`, `released_at` | `text` (default `unlink`), `timestamptz` | |

Index: `(account_id, released_at)`, for an account's history in order.

### `brgy_forwarded_devices`

The sensors a barangay ringserver forwards data for. In MongoDB these were in the brgy account's `devices[]` list, mixed with ownership; here ownership is `devices.owner_account_id` and forwarding is this table, so the two can't be confused.

| Column | Type | Notes |
|---|---|---|
| `brgy_account_id` | `uuid` → `accounts` | the barangay; **links deleted with the account** |
| `device_id` | `uuid` → `devices`, indexed | a sensor owned by another account; **links deleted with the device** |
| `added_at` | `timestamptz` | orders a barangay's list, oldest first |

Primary key `(brgy_account_id, device_id)`: a barangay forwards a sensor only once. A row is added when a sensor's owner verifies with a barangay (`/accounts/verify-sensor-token`) and removed when the sensor is unlinked or the owner removes it from the barangay.

### `events`

One earthquake detected by SeisComP. Column names in brackets are the API field names, which don't change.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, primary key | `uuidv7()` |
| `legacy_mongo_id` | `char(24)`, unique | MongoDB `_id` of a copied row |
| `public_id` | `text`, required, unique | SeisComP event id [`publicID`]; one row per earthquake, whether SeisComP said NEW or UPDATE |
| `source_catalog`, `source_server`, `source_seiscomp_version` | `text` | where the event came from; `source_catalog` defaults to `upri-current` and is indexed |
| `is_legacy_record`, `legacy_imported_at`, `legacy_source_public_id` | `boolean` (default false, indexed), `timestamptz`, `text` | events imported from the old catalog |
| `origin_time` | `timestamptz`, indexed | [`OT`] |
| `latitude`, `longitude` | `double precision` | [`latitude_value`, `longitude_value`]; not range-checked, since old records may hold bad ones |
| `location` | `geography(Point, 4326)` | **generated** from latitude/longitude, **null when they're missing or out of range**; GiST index |
| `depth_km`, `magnitude` | `double precision` | [`depth_value`, `magnitude_value`] |
| `seiscomp_type` | `varchar(10)` | latest SeisComP message type, e.g. `NEW`, `UPDATE`, `M` [`type`] |
| `region_text` | `text` | SeisComP region text [`text`] |
| `place` | `text` | GeoServe place name, filled on first read |
| `recording_status`, `recording_checked_at`, `recording_attempts` | `recording_status` enum (default `pending`, indexed), `timestamptz`, `int` | which nearby stations recorded it: `pending`, `partial`, `verified` or `unavailable` [`recordingAvailability*`] |
| `last_modification` | `timestamptz` | an update older than this is dropped (SeisComP messages can arrive out of order) |
| `summary_override_text`, `summary_override_edited_at`, `summary_override_edited_by` | `text`, `timestamptz`, `text` | summary edited by hand [`summaryOverride`] |
| `created_at`, `updated_at` | `timestamptz` | |

Rules: `public_id` unique and not blank; `recording_attempts` not negative; an edit time or editor only with a summary text. `onlineStations` isn't a column: it's worked out from `event_stations` and the recording status, as the app did when storing it.

### `event_stations`

The stations near an earthquake, linked to their devices. Replaces `candidateStations[]` and `recordingStations[]`, which MongoDB stored as station codes nothing tied to a real device.

| Column | Type | Notes |
|---|---|---|
| `event_id` | `uuid` → `events` | **deleted with the event** |
| `device_id` | `uuid` → `devices`, indexed | the station; **the device can't be deleted while listed** (`ON DELETE RESTRICT`) |
| `kind` | `station_kind` enum | `candidate` (nearest active station at ingest) or `recording` (FDSN has its waveform data) |
| `position` | `smallint` | order in its list, nearest first |

Primary key `(event_id, device_id, kind)`: a station appears once per list. Unique `(event_id, kind, position)`, so the order is always defined. The `device_id` index answers "which earthquakes did this station record?".

### `event_catalog_matches`

The report another catalog has for the same earthquake: at most one per catalog (unique `(event_id, source)`). Replaces `additionalInformation[]`.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, primary key | |
| `event_id` | `uuid` → `events` | **deleted with the event** |
| `source` | `catalog_source` enum | `phivolcs`, `usgs`, or `upri-legacy` (the old UPRI catalog's entry on imported records, which the frontend shows; `postgres-schema.dbml` lists only the first two) |
| `source_label`, `source_icon_url`, `external_id`, `title`, `place`, `location_text`, `detail`, `url`, `detail_url`, `query_url` | `text` | [`sourceLabel`, `sourceIconUrl`, `id`, `title`, `place`, `location`, `detail`, `url`, `detailUrl`, `queryUrl`] |
| `match_time`, `match_time_text` | `timestamptz`, `text` | [`time`]; PHIVOLCS's own date text, GMT+8 [`dateTime`] |
| `latitude`, `longitude`, `depth_km`, `magnitude` | `double precision` | depth is [`depthKm`] in PHIVOLCS and legacy entries, [`depth`] in USGS ones |
| `has_felt_intensity`, `latitude_floor_match`, `longitude_floor_match` | `boolean` | [`hasFeltIntensity`, `latitudeFloorMatch`, `longitudeFloorMatch`] |
| `distance_km`, `time_difference_minutes`, `magnitude_difference`, `score` | `double precision` | how close the match is; lower `score` is better |
| `match_quality` | `match_quality` enum | `high`, `medium` or `low` [`matchQuality`] |
| `position` | `smallint`, default 0 | order among the event's matches: the API returns them in `additionalInformation[]`'s order, which the frontend shows |
| `extra` | `jsonb` object, default `{}` | upstream keys without a column (e.g. a legacy entry's `sourceServer`), and keys whose value is null |
| `raw` | `jsonb` | the full upstream payload, when kept |
| `created_at`, `updated_at` | `timestamptz` | |

### `event_catalog_status`

How far the nightly enrichment job got for one earthquake in one catalog. Replaces `pendingCatalogSources`, `catalogEnrichmentStatus`/`Attempts` and the legacy `upForEnrichment`/`enrichmentAttempts`.

| Column | Type | Notes |
|---|---|---|
| `event_id` | `uuid` → `events` | **deleted with the event** |
| `source` | `catalog_source` | only `phivolcs` or `usgs`, the catalogs the job searches |
| `status` | `enrichment_status` enum, default `pending` | `pending`, `done`, `no_match` or `failed` |
| `attempts` | `int`, default 0 | not negative |
| `updated_at` | `timestamptz` | |

Primary key `(event_id, source)`; index `(source, status)` finds the events still pending for a catalog.

### `comments`

A community report on an earthquake: text, an image, or both. Column names in brackets are the API field names.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, primary key | `uuidv7()`; what marks and reports point to |
| `legacy_mongo_id` | `char(24)`, unique | MongoDB `_id` of a copied row |
| `comment_id` | `uuid`, required, unique | the public id used in URLs [`commentId`]; `gen_random_uuid()` for new rows |
| `event_id` | `uuid` → `events`, required | **deleted with the event** (`ON DELETE CASCADE`) |
| `account_id` | `uuid` → `accounts`, indexed | who posted it; null when posted signed out; **null when the account is deleted** (`ON DELETE SET NULL`): the comment and its username stay |
| `username` | `text`, default `Anonymous` | the name shown |
| `content` | `varchar(1000)` | the text |
| `image_url` | `text` | path of the uploaded image [`imageURL`]; the files themselves stay where they are |
| `status` | `comment_status` enum, default `approved` | `pending`, `approved` or `rejected`; only `approved` is shown |
| `moderated_by`, `moderated_at` | `text`, `timestamptz` | who set the status, and when |
| `created_at`, `updated_at` | `timestamptz` | |

Rules: every comment belongs to a real event; text or an image, not blank; text at most 1000 characters; username not blank. Index `(event_id, status, created_at, comment_id)` serves an event's visible reports newest first, in the API's paging order.

There's no `eventPublicID` column: it's the event's `public_id`. On MongoDB, deleting an account left its comments pointing to it; here they stay, unlinked.

### `comment_helpful_marks`

One row per account that marked a report helpful (replaces `helpfulAccountIds[]`). A report's helpful count is its number of rows.

| Column | Type | Notes |
|---|---|---|
| `comment_id` | `uuid` → `comments.id` | the internal id, not the public `comment_id`; **deleted with the comment** |
| `account_id` | `uuid` → `accounts`, indexed | **deleted with the account** |
| `created_at` | `timestamptz` | copied marks: their comment's `updated_at` (MongoDB kept no time per mark) |

Primary key `(comment_id, account_id)`: **one vote per person**, which MongoDB only kept by how the app wrote the list.

### `comment_issue_reports`

Private moderation flags on a report (replaces `issueReports[]`); never shown publicly.

| Column | Type | Notes |
|---|---|---|
| `comment_id` | `uuid` → `comments.id` | **deleted with the comment** |
| `account_id` | `uuid` → `accounts`, indexed | **deleted with the account** |
| `reason` | `issue_reason` enum | `duplicate`, `unclear`, `wrong_location`, `not_related` or `inappropriate` |
| `created_at` | `timestamptz` | when the account last flagged it |

Primary key `(comment_id, account_id)`: **one flag per person per report**; flagging again replaces the reason and time.

### `contribution_events`

The points ledger: one row per action that earns (or records) points. Rows never change once written, so there's no `updated_at`.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, primary key | `uuidv7()` |
| `legacy_mongo_id` | `char(24)`, unique | MongoDB `_id` of a copied row |
| `dedupe_key` | `text`, required, unique | `account:action:target type:target id`: **an action never counts twice**, even when two requests race |
| `account_id` | `uuid` → `accounts`, required | **deleted with the account** |
| `action_type` | `contribution_action` enum | `report_posted`, `image_report_posted`, `report_marked_helpful`, `report_received_helpful` or `report_issue_submitted` |
| `target_type`, `target_id` | `contribution_target` enum (default `comment`), `text` | what the action was on: a comment's public `comment_id`, or an event |
| `event_id` | `uuid` → `events` | **null when the event is deleted** (`ON DELETE SET NULL`); the points stay |
| `points` | `int`, default 0 | |
| `reason` | `text` | the issue reason, for `report_issue_submitted` |
| `metadata` | `jsonb` object, default `{}` | for an entry copied without its event: `eventPublicID` |
| `created_at` | `timestamptz` | |

Indexes: `(account_id, created_at)` for an account's points over time, `(event_id, created_at)`. Like comments, there's no `eventPublicID` column: it's the event's `public_id`, or `metadata.eventPublicID` for an entry whose event was gone when copied.

### `significant_eq_details`

What admins add to an earthquake for the significant earthquakes page. Which earthquakes are significant isn't stored (see below), and the page's summary is the event's own `summary_override_text`.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, primary key | `uuidv7()` |
| `legacy_mongo_id` | `char(24)`, unique | `_id` of the MongoDB `significant-eqs` entry a copied row came from |
| `event_id` | `uuid` → `events`, required, unique | **one row per event, deleted with the event** |
| `instrument_recordings` | `text[]`, default `{}` | station codes whose recordings the page shows (API: `instrumentRecordings`) |
| `reference_urls` | `text[]`, default `{}` | links to reports (API: `references`; `references` is a reserved word in SQL) |
| `edited_by`, `edited_at` | `text`, `timestamptz` | who last set them, and when |
| `created_at`, `updated_at` | `timestamptz` | |

### Significant earthquakes: the significance score

The significant earthquakes page lists the events this score picks; nothing is picked by hand. It's based on the [USGS significance score](https://earthquake.usgs.gov/earthquakes/statistics/significant.php): its magnitude term and its 600 cut-off are kept; distance and depth weights stand in for its PAGER term (which needs impact estimates we don't have), and our own reports for its "Did You Feel It?" term.

**score = magnitude term × distance weight × depth weight + felt-report bonus**

| Part | Rule |
|---|---|
| Magnitude term | `100 × M² / 6.5` (M6.5 = 650, M7.0 = 754), with the event's own magnitude |
| Distance weight | 1 within 200 km of the Philippines, falling in a straight line to 0 at 1,500 km |
| Depth weight | 1 down to 70 km, 0.8 down to 300 km, 0.5 deeper; an unknown depth counts as shallow |
| Felt-report bonus | +25 per signed-in account with an approved report on the event, up to 20 accounts (+500) |

- **Significant:** a score of 600 or more. Without reports, a shallow quake within 200 km of the Philippines qualifies from about M6.25; a shallow M5.5 needs 6 people's reports.
- **Order:** highest score first, then newest first, then `publicID`. At most 50.
- **Which events count:** those with a magnitude and a location, legacy records included.
- **Distance** is measured to this simplified outline of the Philippines (longitude, latitude), with the seas between the islands included, so an event inside it is 0 km away:

  ```
  121.95 21.15, 122.3 18.6, 122.55 17.0, 122.0 15.5, 124.3 14.1, 125.3 12.6, 125.8 11.0,
  125.7 10.0, 126.6 8.5, 126.6 6.2, 125.7 5.4, 124.0 5.9, 122.0 6.8, 119.3 4.5, 117.0 7.6,
  119.2 11.5, 120.0 13.5, 119.7 16.3, 120.3 18.5, 121.3 20.2, (back to) 121.95 21.15
  ```

The rules and the outline live in [`src/services/significance.js`](src/services/significance.js), as code constants. The events repository's `listSignificanceCandidates` finds the candidates in one query: events within 1,500 km (`ST_DWithin`; farther ones can't reach 600, since the bonus alone is at most 500) whose magnitude term plus bonus reaches 600, each with its distance to the outline and its number of reporters. The score is worked out on each request, behind the endpoint's 5-minute cache; the query took 211 ms on dev's 906 events.

**Checked on dev** (November 2026): 16 of 906 events qualify: 11 in or near the Philippines, 3 in Taiwan (including the April 2024 M7.2) and 2 in the Molucca Sea. Of the 10 old hand-picked quakes, 9 qualify on their own recorded values; the one that doesn't is an M6.4 363 km from the outline and 130 km deep, which scores 441.

**Endpoints** (the frontend's Significant Earthquakes pages read the first two, unchanged):

| Endpoint | What it returns |
|---|---|
| `GET /significant-eqs/all` | The ranked list (`200` with `[]` when none qualify): `_id`, `publicID`, `title` ("M7.8 Earthquake, *place*"), `magnitude`, `depth`, `location` (the place name, or the region), `eventTime`, `eventSummary` (the event's `summaryOverride`, or one built from the event) and `significance` (the score, rounded) |
| `POST /significant-eqs` with `{ "id": "<_id>" }` | One event (any, significant or not) with those fields plus `instrumentRecordings` and `references`; `400` for an invalid id, `404` when not found |
| `PUT /significant-eqs/<_id>/details` (admins) | Sets `instrumentRecordings` (station codes) and/or `references` (http(s) links), up to 50 each; a list left out keeps its value |
| `DELETE /significant-eqs/<_id>/details` (admins) | Removes both |

The frontend has no form for recordings and references, so admins call the last two directly with their session cookie (examples in the API docs, `/api-docs`). The summary is edited on the earthquake detail page, as for any event (`PATCH /eq-events/<publicID>/summary`).

### Scheduled deletes (instead of TTL indexes)

PostgreSQL has no TTL indexes. The cleanup scheduler (`src/services/jobLockCleanup.service.js`, every `JOB_LOCK_CLEANUP_INTERVAL_MIN`, default 60 minutes; off with `JOB_LOCK_CLEANUP_ENABLED=false`) deletes expired job locks, and logs the count:

```
[job-lock-cleanup] expiredLocks=0
```

---

## 8. The final MongoDB dump

Before MongoDB left the dev setup, its `latestEQs` database was dumped one last time. Then the `mongodb` service was removed from `docker-compose.yml`, and its data volume (`earthquake-hub-mongodb-data`) was deleted, on 2026-11-06. **This archive is now the only copy of the dev MongoDB data:** the only way back to MongoDB ([Going back to MongoDB](#going-back-to-mongodb)), and the only record of the old data.

### Where it is

**Stored at:** `C:\Cursor\UPRI-Seismo\mongo-final-dump\`, in the root of the `UPRI-Seismo` folder on the dev machine, outside both repos. As agreed with the team, it stays local for now. Only one Windows account can open the folder.

| File | What it is |
|---|---|
| `latestEQs-dev-2026-11-06.archive.gz` | the archive (`mongodump --archive --gzip`), 255 KB |
| `latestEQs-dev-2026-11-06.manifest.json` | when and how it was made, the count per collection, and its SHA-256 |
| `latestEQs-dev-2026-11-06.mongodump.log` | mongodump's output |

**It holds personal data** (emails, password hashes):
- Keep access restricted.
- Never commit it.

This is the dev database. The production export used by the end-to-end check is a separate file, with its own storage and deletion rules.

### The manifest

| | |
|---|---|
| Dumped | 2026-11-06 02:49 UTC, from the dev `mongodb` container, as the app user |
| MongoDB | 8.0.32 (mongodump 100.19.1) |
| Backend | `feat/postgres-migration` at `5c37108` |
| SHA-256 | `a0a9e1b9a140735d1c6acc82804860320ef4f7a2d2168ec467d10beac72580e6` |

| Collection | Documents |
|---|---|
| `accounts` | 85 |
| `devices` | 26 |
| `events` | 906 |
| `comments` | 0 |
| `contributionevents` | 0 |
| `joblocks` | 0 |
| `significant-eqs` | 0 |
| `subscriptions` | 0 |

How it was made (inside the `mongodb` container, so nothing needs installing):

```sh
docker exec mongodb mongodump --host localhost --port 27017 \
  -u <MONGO_USER> -p <MONGO_PASSWORD> --authenticationDatabase <MONGO_AUTH_SOURCE> \
  --db latestEQs --excludeCollection=system.profile --archive --gzip \
  > latestEQs-dev-2026-11-06.archive.gz
```

`system.profile` is left out: it's the profiler's own log, which was on while the dump was taken (below).

### How it was checked

1. **Nothing missing in PostgreSQL:** every copy script's dry run found nothing to insert and nothing to skip, and exited with 0:
    - `db:pg:copy-people-and-sensors`
    - `db:pg:copy-earthquakes`
    - `db:pg:copy-community`

    (`db:pg:copy-subscriptions` no longer exists: push notifications were removed, and dev has no subscriptions.)
2. **A consistent snapshot:** each collection's count was the same just before and just after the dump.
3. **It restores:**
    - It was restored into a throwaway MongoDB 8.0.32 container with no network: 1,017 documents restored, 0 failed.
    - Every collection's count matches the manifest.
    - Every collection's documents and indexes are identical to dev MongoDB's.
    - Spot checks on an account, an event with 2 catalog matches, and a device: identical. Dev has no comments to check.
4. **It agrees with PostgreSQL:**
    - Every account (85), device (26) and event (906) in the dump has its PostgreSQL row, and PostgreSQL has none that the dump lacks.
    - Event stations (6,548) and catalog matches (1,204) are the same on both. There are 1,812 catalog status rows: 2 per event.
    - Comments and points: 0 on both.
5. **MongoDB is idle:**
    - The profiler logged every operation on `latestEQs` from 2026-11-06 02:49 UTC until MongoDB was stopped, at about 06:01 UTC: 3 hours 12 minutes.
    - **Result: 0 operations from the backend** (its container's address, `172.22.0.3`). All 73 logged operations came from `127.0.0.1`: the dump and the checks above, run inside the container.
    - MongoDB's oplog shows no writes to `latestEQs` in that time, so nothing changed after the dump.
    - **Skipped: a full day of dev use, including the 02:00 Manila enrichment run and the station checks.** The ticket asks for one. It was skipped because this is the dev environment: the dump holds dev data, and dev can't reach the sensors, so the station checks have nothing to check. The full day was there to catch backend writes the dump would miss, and the oplog shows there were none.

    The log was read after MongoDB stopped, from a copy of its data volume (`earthquake-hub-mongodb-data`), so the volume itself wasn't changed. The profiler switches off when MongoDB restarts. Its log (`system.profile`) stays in the volume, and isn't in the dump.

### How to restore it

1. Check the archive against the manifest:

    ```sh
    sha256sum latestEQs-dev-2026-11-06.archive.gz
    ```

2. Restore it into a throwaway MongoDB with no network, and count each collection:

    ```sh
    docker run -d --name mongo-restore --network none mongo:8.0.32
    docker exec -i mongo-restore mongorestore --archive --gzip < latestEQs-dev-2026-11-06.archive.gz
    docker exec mongo-restore mongosh --quiet latestEQs --eval '
      db.getCollectionNames().sort().forEach((c) => print(c, db.getCollection(c).countDocuments()))'
    ```

3. Look things up with `mongosh` (`docker exec -it mongo-restore mongosh latestEQs`), then remove it:

    ```sh
    docker rm -f mongo-restore
    ```

### Loading it into PostgreSQL

To fill a new or emptied dev database with the old dev data, restore the dump into a throwaway MongoDB that your machine can reach, then run the copy scripts against it in order (accounts and devices, then earthquakes, then comments and points, then the significant earthquake details):

```sh
docker run -d --name mongo-load -p 127.0.0.1:27018:27017 mongo:8.0.32
docker exec -i mongo-load mongorestore --archive --gzip < latestEQs-dev-2026-11-06.archive.gz

export MONGO_CONNX_TYPE=docker MONGO_HOST=localhost MONGO_PORT=27018 MONGO_NAME=latestEQs
npm run db:pg:copy-people-and-sensors -- --dry-run
npm run db:pg:copy-people-and-sensors
npm run db:pg:copy-earthquakes
npm run db:pg:copy-community
npm run db:pg:copy-significant-eq-details

docker rm -f mongo-load
```

In PowerShell, set the four keys with `$env:MONGO_HOST='localhost'` and so on. Set in the shell, they win over `.env`. Run the migrations first (1.3). Each copy must end with `Validation passed` ([section 6](#copying-accounts-and-devices)). This was tested on 2026-11-06: all three dry runs against dev exit with 0 and find every row already there.

### Going back to MongoDB with it

Restore into the `mongodb` container of a backend from before Phase 4, with the app user, as [Going back to MongoDB](#going-back-to-mongodb) describes:
- Add `--drop`, which replaces each collection with the archive's version.
- Anything written to PostgreSQL after 2026-11-06 02:49 UTC is not in the archive.

---

## 9. Troubleshooting

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
| `relation "job_locks" does not exist` (or another table) | The migrations haven't run | `npm run db:pg:migrate` |
| Backend exits with `JOB_LOCKS_DB must be "postgres" (got "mongodb")` (or another area) | An old `.env` still sets an area to `mongodb`, or has a typo | Remove the setting from `.env`: unset means `postgres` |
| `KnexTimeoutError: Knex: Timeout acquiring a connection. The pool is probably full`, while PostgreSQL is up | New connections waited behind slow DNS lookups. Before the fix, a full event list sent a GeoServe request for every event without a place, and an unresolvable `GEOSERVE_HOST` (as in dev) kept Node's 4 DNS threads busy for minutes | Fixed in `a3a96fb` and `4fdf2f5`: at most 2 GeoServe requests at once, none for 60 s after GeoServe can't be reached, and 2 pool connections kept open. If it comes back, check that `GEOSERVE_HOST` resolves inside the backend container |
