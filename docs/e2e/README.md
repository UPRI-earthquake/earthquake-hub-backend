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
    - Changes only what keeps the test safe: every email becomes `user-<hash>@example.invalid` (two that clash ignoring case still clash), and one sample account per kind gets a known test password. The kinds are sensor owner, citizen, brgy and admin.
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
