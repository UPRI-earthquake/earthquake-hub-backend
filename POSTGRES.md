# PostgreSQL: Local Setup, Migrations & GUI Clients

The backend runs on **PostgreSQL 18 with PostGIS 3.6**, and only on it: there's no MongoDB service, client or code. It moved there from MongoDB one area at a time: job locks, accounts and devices, earthquakes, and comments and points ([section 6](#6-history-the-move-from-mongodb)). The tables and their rules are in [`DB_SCHEMA.md`](DB_SCHEMA.md).

The old dev MongoDB data is kept in the final dump ([section 8](#8-the-final-mongodb-dump)).

Queries and schema changes go through [Knex](https://knexjs.org): `src/db/knex.js` holds the connection pool, `src/db/migrations/` the versioned schema changes.

1. [First-time local setup](#1-first-time-local-setup)
2. [Running migrations](#2-running-migrations)
3. [Connecting with a GUI client](#3-connecting-with-a-gui-client)
4. [Integration tests](#4-integration-tests)
5. [Repositories and golden files](#5-repositories-and-golden-files)
6. [History: the move from MongoDB](#6-history-the-move-from-mongodb)
7. [Tables, significance score and scheduled deletes](#7-tables-significance-score-and-scheduled-deletes)
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

Docker Compose creates the `earthquake-hub-postgres-data` volume on first start. The backend and PostgreSQL are the only services.

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

The old dev data, accounts included, is in the final MongoDB dump. Loading it needs the copy scripts, which were removed with MongoDB ([Using it](#using-it)).

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

---

## 5. Repositories and golden files

Each area's database calls are in a **repository**: a module in `src/repositories/` that holds all of that area's queries. Services call the repository, never Knex directly. The areas moved to PostgreSQL this way: each repository had a MongoDB and a PostgreSQL version until MongoDB was removed ([section 6](#6-history-the-move-from-mongodb)). Now `src/repositories/<area>.repo.js` exports the PostgreSQL one, from `src/repositories/postgres/`.

| Area | Repository |
|---|---|
| Job locks | `src/repositories/jobLocks.repo.js` |
| Accounts | `src/repositories/accounts.repo.js` |
| Devices (and each account's device list and release history) | `src/repositories/devices.repo.js` |
| Earthquake events (with their stations, catalog matches and enrichment status) | `src/repositories/events.repo.js` |
| Comments (with their helpful marks and issue reports) | `src/repositories/comments.repo.js` |
| Contribution points | `src/repositories/contributions.repo.js` |

Accounts and devices reference each other, and share one transaction helper (`src/repositories/transactions.js`). In their repositories:

- email and username lookups ignore case through `citext`, with no lowercasing in code; usernames therefore became case-insensitive, as emails already were
- a citizen's device list is the devices it owns (`devices.owner_account_id`); a brgy's is `brgy_forwarded_devices`
- linking a device (the device, the account's list, clearing its release history) and releasing one (taking it out of the list, writing its `device_releases` row) each run in one transaction, so a failed step changes nothing

Repositories return plain objects with an `id`, and services change data only through repository functions. Two shared helpers:

- `src/repositories/errors.js`: a write that breaks a unique rule throws `DuplicateKeyError` (with the colliding `fields`).
- `src/repositories/transactions.js`: `withTransaction(async (tx) => { ... })` runs writes together; repository functions join it when passed `{ tx }`.

Comments come back with their helpful marks (`helpfulAccountIds`) and issue reports (`issueReports`) as lists, and event and account ids as MongoDB-style strings, as they did on MongoDB: marks and reports are in their own tables. An account marks a comment helpful once and has one issue report per comment (a second replaces the first); a points entry is stored once per `dedupeKey`, and a repeated action leaves the first one as it was. Posting a report, marking one helpful and reporting an issue each write the comment change and its points in **one transaction** (`src/repositories/communityTransactions.js`), so a failed points write leaves no half-done mark.

Two kinds of integration tests guard the API:

- **Repository tests** (`__tests__/<area>.repo.integration.test.js`) describe what each repository function does with real data. Until MongoDB was removed they ran the same cases against both versions.
- **Golden files** (`__tests__/golden/*.json`) are API responses recorded while the areas ran on MongoDB: status, key headers (including `Set-Cookie`) and body. The `*.golden.postgres.integration.test.js` files (`peopleAndSensors` for accounts and devices, `earthquakes`, and `community` for comments and points) run the real app against seeded data, and compare each response with its recording. `earthquakes` fakes GeoServe, FDSN, PHIVOLCS and USGS (`__tests__/fixtures/earthquakesExternal.js`). No endpoint returns points, so `community` also records the points stored after each request (or checks them unchanged). The data is defined as MongoDB stored it, and seeded in PostgreSQL as the copy from MongoDB wrote it (`__tests__/fixtures/copiedRows.js`), so the responses also show that copied data keeps its ids. Seeded records hold only what both databases could represent (PostgreSQL can't tell a missing field from a null one), e.g. an ingested event's legacy fields are null, as ingest writes them.

Values that change on every run are made stable before comparing (see `__tests__/fixtures/golden.js`): a JWT is recorded as its decoded claims (`iat` as `<now>`, `exp` as `<now + Ns>`), timestamps from the current run as `<now>`, and random secrets and newly generated ids as placeholders. Seeded data uses fixed past dates, which are recorded as they are.

Integration tests never follow your `.env`'s area settings: `__tests__/fixtures/integrationEnv.js` (a `setupFilesAfterEnv` entry, so the `--setupFiles` of `npm run test:integration` can't replace it) empties every area setting before each test file, so each area takes its default, `postgres`. The app's dotenv call never overrides a variable that's already set, even an empty one.

Re-record golden files only when a response is meant to change, and review the diff in the PR:

```sh
UPDATE_GOLDEN=1 npm run test:integration
# PowerShell: $env:UPDATE_GOLDEN=1; npm run test:integration; Remove-Item Env:UPDATE_GOLDEN
```

---

## 6. History: the move from MongoDB

The backend ran on MongoDB until November 2026. It moved to PostgreSQL on `feat/postgres-migration`, one area at a time:

| Step | Area | Tables |
|---|---|---|
| 1 | Job locks | `job_locks` |
| 2 | Accounts and devices | `accounts`, `devices`, `device_releases`, `brgy_forwarded_devices` |
| 3 | Earthquakes | `events`, `event_stations`, `event_catalog_matches`, `event_catalog_status` |
| 4 | Comments and points | `comments`, `comment_helpful_marks`, `comment_issue_reports`, `contribution_events` |

How an area moved:
- **Behind its repository:** each area's database calls went into a repository with a MongoDB and a PostgreSQL version ([section 5](#5-repositories-and-golden-files)). A per-area setting (`JOB_LOCKS_DB`, `PEOPLE_AND_SENSORS_DB`, `EARTHQUAKES_DB`, `COMMUNITY_DB`) picked one at startup, so moving or rolling back an area was a configuration change.
- **Copied, not dual-written:** a copy script (`npm run db:pg:copy-*`) copied the area's MongoDB data into PostgreSQL. It was safe to run again, listed every record it skipped and why, and validated the counts. An area was never written to both databases.
- **Checked:** the repository tests ran the same cases on both versions; the golden files, recorded on MongoDB, had to match on PostgreSQL; and the end-to-end check compared the two backends on production data ([`docs/e2e/E2E_RESULTS.md`](docs/e2e/E2E_RESULTS.md)).

Then Phase 4 removed MongoDB, first from the dev setup (no `mongodb` service, no connection, and the area settings accepting only `postgres`), then from the code: Mongoose and its models, the MongoDB repositories, the per-area switch, and the copy, MongoDB maintenance and import scripts. The dev MongoDB data is in the final dump ([section 8](#8-the-final-mongodb-dump)).

**Production still runs on MongoDB.** Its move needs the switch and the copy scripts, which are in git history: the last commit with them is `f4e7db9` on `feat/postgres-migration`. Its `POSTGRES.md`, section 6, describes each copy script, what it skips, and how to roll an area back. Before production moves, handle the end-to-end check's findings 2 and 3: fields only production has, and an email clash ([`docs/e2e/E2E_RESULTS.md`](docs/e2e/E2E_RESULTS.md)).

### Ids the API shows: MongoDB-style

**The rule:** whatever id a client sees is the MongoDB-style id (`legacy_mongo_id`), never the PostgreSQL uuid. The uuid is used only inside PostgreSQL (keys and joins). Every row a client can name has one: a row copied from MongoDB kept its old `_id`, and an account, device or event created in PostgreSQL gets a new one (`newLegacyId()` in `src/repositories/postgres/legacyIds.js`, from the `bson` package). Repositories return it as `legacyId` (or as `_id`, `eventId`, `accountId` in the API's shapes).

Why: clients (the frontend, sensors, open sessions) already hold account, device and event ids from earlier responses, and while areas moved one at a time, the ones still on MongoDB named the others by those ids. Dropping them is a separate change, for when nothing depends on them (every client and open session would have to move to the uuids at once). So:

- **Session tokens carry the account's `legacyId`**, so comments keep their author id. A session from before the move keeps working: tokens are checked by signature, accounts are looked up by username, and the `accountId` inside the token is still the account's `legacy_mongo_id`.
- **The comments and points repositories take MongoDB-style ids:** an account's (from the session token) and an event's (from `GET /comments?eventId=`), and find the row through `legacy_mongo_id` (`src/repositories/postgres/legacyIds.js`). Admin responses return `eventId`, `eventPublicID` (the event's `public_id`) and `accountId` the same way.
- **An event's `_id` is its `legacy_mongo_id`:** comments and points store that id, and `comments.service.js` finds the event by it through the events repository (`findRefById`), so comments from before the move still list under their event.
- **Device ids in responses are the device's `legacyId`:** `deviceId` in alert credentials (`/device/alert-credential`, `/device/link`) and in `releasedDevices[]`. A released device keeps its id in `device_releases.device_legacy_mongo_id`, so the history still shows it after the device is deleted, as MongoDB did.
- A comment's own `commentId` was always a UUID and stays the same.

The golden files check the ids in every recorded response.

### What the API shows differently

What changed in the API with the move, compared field by field on dev's 906 events and on production data by the end-to-end check. The frontend reads none of it.

| Field | Events (dev) | Why |
|---|---|---|
| `legacyImportedAt`, `legacySourcePublicID` | 847 | missing on old MongoDB records; `null` in PostgreSQL, as ingest writes them |
| `catalogEnrichmentAttempts` | 835 | `{}` in MongoDB; the per-catalog attempts the copy took from the legacy counter |
| `createdAt`, `__v` | 721, 682 | missing on old MongoDB records; always set in PostgreSQL |
| `candidateStations` | 14 | older records only had `onlineStations`, which became their candidates (`onlineStations` is unchanged) |
| `catalogEnrichmentStatus` | 2 | the events with no enrichment tracking got pending status rows |
| `onlineStations` | 2 | same stations, nearest first |

Also:
- `onlineStations` is worked out on read, so after an UPDATE for an event that already has recording stations it shows what the recording status implies, where MongoDB stored recording and candidate stations merged until the next station check.
- An event's stored point (`location`) isn't sent: it's only for location queries, and the frontend reads an event's `location` as a place name (a point there showed as "[object Object]", found by the end-to-end check).
- **Usernames are case-insensitive** (`citext`), as emails already were: `Juan` and `juan` are the same account.
- A comment whose author's account was deleted shows `accountId: null` to admins, where MongoDB kept the deleted account's id.
- A session whose account no longer exists can still post (unlinked, under its username) but can't mark, flag or earn points, which need a real account.

---

## 7. Tables, significance score and scheduled deletes

The tables, their columns and the rules they enforce are in [`DB_SCHEMA.md`](DB_SCHEMA.md), with the diagram in [`docs/postgres-schema.dbml`](docs/postgres-schema.dbml).

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

Before MongoDB left the dev setup, its `latestEQs` database was dumped one last time. Then the `mongodb` service was removed from `docker-compose.yml`, and its data volume (`earthquake-hub-mongodb-data`) was deleted, on 2026-11-06. **This archive is now the only copy of the dev MongoDB data,** and the only record of the old data.

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

### Using it

Loading the dump into PostgreSQL, or going back to MongoDB with it, needs the code that was removed with MongoDB. Check out `f4e7db9` on `feat/postgres-migration` (the last commit with it), then follow its `POSTGRES.md`:
- **Into PostgreSQL** ("Loading it into PostgreSQL"): restore the dump into a throwaway MongoDB your machine can reach, then run the copy scripts against it.
- **Back to MongoDB** ("Going back to MongoDB"): use a backend from before Phase 4 (`d94371c`), which still has the `mongodb` service, and restore the dump into it with the app user and `--drop`.

Anything written to PostgreSQL after 2026-11-06 02:49 UTC is not in the archive.

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
| `KnexTimeoutError: Knex: Timeout acquiring a connection. The pool is probably full`, while PostgreSQL is up | New connections waited behind slow DNS lookups. Before the fix, a full event list sent a GeoServe request for every event without a place, and an unresolvable `GEOSERVE_HOST` (as in dev) kept Node's 4 DNS threads busy for minutes | Fixed in `a3a96fb` and `4fdf2f5`: at most 2 GeoServe requests at once, none for 60 s after GeoServe can't be reached, and 2 pool connections kept open. If it comes back, check that `GEOSERVE_HOST` resolves inside the backend container |
