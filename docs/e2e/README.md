# End-to-end check: the backend against a saved baseline

Phase 4 - Ticket 1 ran the same backend twice on the same production data, once on MongoDB and once on PostgreSQL, and compared their API responses and the frontend's pages. Its results, and its re-runs after MongoDB was removed, are in [`E2E_RESULTS.md`](E2E_RESULTS.md).

MongoDB is gone now, so the check compares the backend with a **saved baseline** instead: a database dump, and the responses the backend gave on it when the baseline was recorded. Restore the dump, run the backend, call the same endpoints, and any difference shows. Use it to check that a change to the backend leaves its responses as they were.

## A baseline

A baseline is an output folder, outside the repos (default: `../e2e-output`, next to the backend):

| File | What it is |
|---|---|
| `baseline/postgres.dump` | the database before any read or write (`pg_dump --format=custom`) |
| `table-checks.json` | each table's count in that database |
| `sample-accounts.json` | the accounts the comparisons sign in as, one per kind (citizen, sensor owner, brgy), and their password |
| `baseline/api-reads.json`, `baseline/api-writes.json` | the responses recorded on it |

**Personal data:** a baseline made from production data (as Ticket 1's was) holds personal data. Keep it outside the repos, restrict access to it, and delete it when the check is done. Ticket 1's baseline was deleted with its export when that ticket closed.

**Make a new one from the seeded test data** (`scripts/seed-dev-data.js`), which has no personal data. Record it from the code you want to compare against, e.g. before a change:

```sh
node scripts/e2e/seed-baseline.js           # the database: migrated and seeded, then dumped
node scripts/e2e/start-backend.js           # the backend on it (until stopped, Ctrl+C)
node scripts/e2e/compare-api.js --record    # in another terminal: every read, saved
node scripts/e2e/compare-writes.js --record # every write flow, saved
```

Neither script overwrites a baseline: record into an empty output folder (give its path as the first argument to every script).

## Comparing against a baseline

```sh
node scripts/e2e/restore-baseline.js        # the database, as the baseline saved it
node scripts/e2e/start-backend.js           # the backend on it (until stopped)
node scripts/e2e/compare-api.js             # in another terminal: every read
node scripts/e2e/compare-writes.js          # every write flow
```

Start the backend after the restore, which recreates the database. Restore again before each repeat: the write flows leave data behind.

### The services

`e2e/docker-compose.yml` runs a throwaway PostgreSQL and a mail catcher, bound to loopback. `seed-baseline.js` and `restore-baseline.js` start them:

| Service | Port |
|---|---|
| PostgreSQL (`ehub_e2e`) | 55432 |
| Mailpit (SMTP / web UI) | 1125 / 8125 |

To stop them and remove their data:

```sh
docker compose -f e2e/docker-compose.yml down -v
```

### What each step does

- **`restore-baseline.js`** recreates the database, restores the dump, applies the migrations added since it was taken, empties the mail catcher, and checks every table's count against `table-checks.json`.
- **`start-backend.js`** runs this branch's backend at http://localhost:5102 (its frontend's address: http://localhost:3102), logging to `backend.log` in the output folder.
  - It reads the developer's `.env` for secrets, but the database and mail settings come from `scripts/e2e/env.js`, which never points at dev.
  - Every outside service is pointed at a dead local address (`127.0.0.1:9`): GeoServe (places come from the stored data, or show "Unavailable"), FDSN, the ringserver and the device tunnels. The nightly catalog enrichment never runs.
  - Reports' images go to `uploads/` in the output folder.
  - The backend listens on every interface, so run the check where a firewall keeps 5102 closed to the network.
- **`compare-api.js`** calls every read endpoint the frontend uses, for every record, and compares each response field by field with the baseline's. It writes `api-reads.json`.
  - Covered: the whole event list and every event's page, every event's comments (every page, by cursor and by offset), the device list and every station's status, the ringserver hosts, and each sample account's profile and devices.
  - Against a baseline recorded on MongoDB (Ticket 1's), the differences `POSTGRES.md` documents ("What the API shows differently") are counted apart. Any other difference fails the run.
  - The full event list's events with no place come last, in the order their GeoServe lookups end, which varies from call to call: they're compared as a set, the rest in order ([`E2E_RESULTS.md`](E2E_RESULTS.md), finding 13).
- **`compare-writes.js`** runs every write flow the frontend and the sensors use, step by step, and compares each response with the baseline's, after the goldens' normalization (new ids and this run's times as placeholders, tokens as their claims). It writes `api-writes.json`.
  - Flows: accounts (register to delete, with the password reset through Mailpit), sensors (link, station status, brgy forwarding, unlink, reset-link), comments (text, image, anonymous; helpful marks; issue reports; moderation and delete), an earthquake summary, and a SeisComP event with its live-feed message.
  - It reuses the baseline's run id (from its "E2E check \<id\>" comment), so its throwaway accounts, sensor and SeisComP event are the baseline's.

## The frontend (optional)

The browser tests (`e2e/frontend`, Playwright) record what each page shows: its visible text, a screenshot, and its console errors and failed requests. They were written for the frontend Ticket 1 tested (its production build, before `enhance/refactor`), so they need that build in the output folder (`frontend-build/`).

```sh
node scripts/e2e/serve-frontend.js          # the build, talking to the backend (until stopped)
cd e2e/frontend && npm ci && npx playwright install chromium
E2E_RUN=<a name> E2E_RECORD_AS=baseline npx playwright test   # record the baseline's pages
E2E_RUN=<the same name> npx playwright test                   # a later run (saved as postgres)
cd ../.. && node scripts/e2e/compare-frontend.js              # baseline vs postgres
```

`compare-frontend.js` gives one verdict per page: **same**, **same content, other order** (e.g. the map overlays, listed in the order their files load), or **DIFF**. Every request that isn't to localhost is blocked (map tiles stay blank), and usernames, emails and reporters' initials are blanked before each screenshot.

## When the check is done

Stop the services and remove their data (above). If the output folder holds production data, delete it.
