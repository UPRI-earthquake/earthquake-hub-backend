# End-to-end check: MongoDB vs PostgreSQL on production data

Phase 4 - Part 1 of the PostgreSQL migration. The same backend runs twice on the same production data, once with every area on MongoDB and once with every area on PostgreSQL. The API responses and the frontend are then compared. Results go in [`E2E_RESULTS.md`](E2E_RESULTS.md).

## The export is personal data

The production export (one `mongoexport` JSON file per collection) holds real emails, password hashes and usernames:

- Keep it outside both repos. The scripts read it from `../latestEQs.110526` next to the backend by default.
- Everything made from it also stays outside the repos, in `../e2e-output`: the import and copy reports, the sample accounts, and the saved baseline.
- Delete both when the check is done.

## Building the environment

Needs Docker. From the backend folder:

```sh
node scripts/e2e/setup.js [export folder] [output folder]
```

The run starts from scratch every time:

1. **Starts the throwaway services** in `e2e/docker-compose.yml`, all bound to loopback:

    | Service | Port |
    |---|---|
    | MongoDB (single-node replica set) | 27117 |
    | PostgreSQL | 55432 |
    | Mailpit (SMTP / web UI) | 1125 / 8125 |

2. **Migrates PostgreSQL** and empties every table.
3. **Imports the export into MongoDB** (`scripts/e2e/import-prod-json.js`):
    - Reads Extended JSON, so `$oid` and `$date` become ObjectIds and Dates again.
    - Builds the app's indexes first, so duplicates are rejected as production would.
    - Changes only what keeps the test safe: every email becomes `user-<hash>@example.org` (two that clash ignoring case still clash), and one sample account per kind gets a known test password. The kinds are sensor owner, citizen, brgy and admin.
    - Records what it finds, structure only, in `import-report.json`.
4. **Copies to PostgreSQL** with the real copy scripts: accounts and devices, then earthquakes, then comments and points (`copy-*.log`).
5. **Checks every table and link** (`table-checks.json`):
    - counts per table: MongoDB, PostgreSQL, and what each copy skipped
    - each comment's event and author
    - each device's owner
    - each event's stations

To stop the services, and remove their data:

```sh
docker compose -f e2e/docker-compose.yml down -v
```

The backends read these databases through the environment in `scripts/e2e/env.js`, which never points at dev. Email goes to Mailpit, never to a real address.

## Running the check

Run the stages in this order, right after `setup.js`, so every result comes from the same fresh data. Rebuild with `setup.js` before running them again: the write flows and the browser tests leave reports behind, and a report posted in an earlier run shows a different time on each backend.

### 1. Both backends

```sh
node scripts/e2e/start-backends.js [output folder]
```

Runs this branch twice until stopped (Ctrl+C), with logs in `backend-mongodb.log` and `backend-postgres.log`:

| Backend | Areas on | API | Its frontend |
|---|---|---|---|
| `mongodb` | MongoDB | http://localhost:5101 | http://localhost:3101 |
| `postgres` | PostgreSQL | http://localhost:5102 | http://localhost:3102 |

Both read the developer's `.env` for secrets. Every outside service it names is pointed at a dead local address (`127.0.0.1:9`), so nothing reaches production and both backends see the same unreachable world:
- GeoServe, so places come from the stored data or show "Unavailable"
- FDSN
- the ringserver
- the device tunnels

The nightly catalog enrichment never runs.

The backend listens on every interface (`listen(port)` in `src/index.js`). Run the check on a machine whose firewall keeps 5101 and 5102 closed to the network.

### 2. API reads

```sh
node scripts/e2e/compare-api.js
```

Calls every read endpoint the frontend uses, for every record, on both backends, and compares them field by field. Differences listed in `POSTGRES.md` ("What the API shows differently") are counted apart. Any other difference fails the run.

Writes `api-reads.json`, and `baseline/api-reads.json` (every MongoDB response, for the re-run after Part 4).

### 3. API writes

```sh
node scripts/e2e/compare-writes.js
```

Runs every write flow the frontend and the sensors use, step by step with the same input on both backends:
- accounts, including the password reset through Mailpit
- sensors
- comments, helpful marks, issue reports and moderation
- an earthquake summary
- a SeisComP event and its live-feed message

It compares the responses after the goldens' normalization. Its throwaway accounts and comments are removed afterwards. Writes `api-writes.json` and `baseline/api-writes.json`.

### 4. The frontend

Build the frontend once, outside the repos, from the frontend folder:

```sh
BUILD_PATH=../e2e-output/frontend-build GENERATE_SOURCEMAP=false REACT_APP_FDSNWS=http://localhost:9/fdsnws npx react-scripts build
```

Serve it twice, each copy talking to its own backend (until stopped):

```sh
node scripts/e2e/serve-frontend.js
```

The frontend reads its backend from `/config.js` at runtime, so its code doesn't change. Then run the browser tests (Playwright, once against each copy, MongoDB first) and compare them:

```sh
cd e2e/frontend && npm ci && npx playwright install chromium
E2E_RUN=<any new name> npx playwright test
cd ../.. && node scripts/e2e/compare-frontend.js
```

The tests (`e2e/frontend/tests/pages.spec.js`) visit the home page, five kinds of earthquake page, the removed significant earthquakes page and the reset password page. They sign in as each sample account to see its dashboard and account settings, register an account, post a report and mark it helpful.

For each page they save to `frontend/<backend>/` in the output folder:
- the visible text, with times relative to now normalized
- a full-page screenshot (PNG, plus a smaller JPEG)
- the console errors and failed requests

Playwright's own files, such as a failed test's screenshot and trace, go to `frontend/test-results/` in the output folder too, never into the repo.

How the tests keep personal data and production out:
- Every request that isn't to localhost is blocked, so map tiles stay blank on both runs.
- Usernames, emails and reporters' initials are blanked in the page before each screenshot.

`compare-frontend.js` writes `frontend-compare.json` and gives one verdict per page:
- **same:** same text in the same order, with the same console errors and failed requests
- **same content, other order:** the same lines, but some moved (e.g. the map overlays, listed in the order their files load)
- **DIFF:** anything else; the run fails

## When the check is done

Copy the screenshots worth keeping into `docs/e2e/screenshots/` (check each one for personal data first). Then delete the export, the output folder and the services:

```sh
docker compose -f e2e/docker-compose.yml down -v
```
