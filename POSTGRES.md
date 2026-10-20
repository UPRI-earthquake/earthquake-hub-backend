# PostgreSQL: Local Setup, Migrations & GUI Clients

The backend is moving from MongoDB to **PostgreSQL 18 with PostGIS 3.6**, one area at a time. During the migration both databases run side by side in Docker, and the backend connects to both on startup. No data lives in PostgreSQL yet: this setup is the base for the later migration steps.

Queries and schema changes go through [Knex](https://knexjs.org): `src/db/knex.js` holds the connection pool, `src/db/migrations/` the versioned schema changes.

1. [First-time local setup](#1-first-time-local-setup)
2. [Running migrations](#2-running-migrations)
3. [Connecting with a GUI client](#3-connecting-with-a-gui-client)
4. [Integration tests](#4-integration-tests)
5. [Repositories and golden files](#5-repositories-and-golden-files)
6. [Troubleshooting](#6-troubleshooting)

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

Each area moves to PostgreSQL behind a **repository**: a module in `src/repositories/` that holds all of that area's database calls. Services call the repository, never a Mongoose model or Knex directly, so moving an area means rewriting its repository and nothing above it.

| Area | Repository | Database |
|---|---|---|
| Job locks | `src/repositories/jobLocks.repo.js` | MongoDB |
| Push subscriptions | `src/repositories/pushSubscriptions.repo.js` | MongoDB |
| Significant earthquakes | `src/repositories/significantEqs.repo.js` | MongoDB |

Two kinds of integration tests check that a move changes nothing:

- **Repository tests** (`__tests__/<area>.repo.integration.test.js`) describe what each repository function does with real data. The PostgreSQL version of a repository must pass the same tests.
- **Golden files** (`__tests__/golden/*.json`) are recorded API responses: status, key headers and body. [`pilotAreas.golden.integration.test.js`](__tests__/pilotAreas.golden.integration.test.js) runs the real app against seeded data and compares each response with its recording.

Re-record golden files only when a response is meant to change, and review the diff in the PR:

```sh
UPDATE_GOLDEN=1 npm run test:integration
# PowerShell: $env:UPDATE_GOLDEN=1; npm run test:integration; Remove-Item Env:UPDATE_GOLDEN
```

---

## 6. Troubleshooting

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
