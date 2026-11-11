# End-to-end check results: MongoDB vs PostgreSQL

Phase 4 - Part 1 of the PostgreSQL migration, dev environment only. The same backend ran twice on the same production data: once with every area on MongoDB, once with every area on PostgreSQL. The API responses and the frontend were then compared. How to run it: [`README.md`](README.md).

| | |
|---|---|
| Run on | Nov 5, 2026 |
| Code | branch `feat/postgres-migration`, the commit that adds this file |
| Data | production export `latestEQs.110526` (MongoDB, exported Nov 5, 2026) |
| Frontend | `earthquake-hub-frontend` as it is, unchanged (production build) |

**Result: no differences that matter between the two backends.**
- One finding was a real bug, the "[object Object]" title. It was fixed, and the whole check run again.
- Two findings need action before production moves to PostgreSQL: fields only production has, and an email clash.
- The rest are explained below and accepted.

**Contents**
1. [Summary](#summary)
2. [Findings](#findings)
3. [Data: import and copy](#data-import-and-copy)
4. [API reads](#api-reads)
5. [API writes](#api-writes)
6. [Frontend](#frontend)
    - [Screenshots](#screenshots)
7. [Coverage](#coverage)
8. [Re-run after Part 4](#re-run-after-part-4)

## Summary

| Stage | What was checked | Result |
|---|---|---|
| Import | the export into the end-to-end MongoDB | 1,030 records, 0 rejected |
| Copy to PostgreSQL | the real copy scripts | all 3 validated; 2 accounts skipped (finding 3) |
| Tables and links | counts per table; every comment's event and author, device's owner, event's stations | all ok |
| API reads | every read the frontend makes, for every record | 2,756 requests: 0 undocumented differences |
| API writes | 49 steps of every write flow | 49 steps, 49 the same, 0 different |
| Frontend | 16 pages and flows, each on both backends | 16 pages: 13 same, 3 same content in another order (finding 6), 0 different |

## Findings

| # | Finding | Status |
|---|---|---|
| 1 | Earthquake pages with no place name showed **"[object Object]"** as their title and in their summary | **Fixed** |
| 2 | Production's data has fields from the `admin-dashboard` branch, which this branch doesn't have, so PostgreSQL has nowhere to keep them | Accepted on dev; **to handle before production** |
| 3 | Two production accounts have the same email, ignoring case | Accepted on dev; to fix before production |
| 4 | 47 entries in accounts' device lists point at devices that don't exist | Accepted |
| 5 | The significant earthquakes page shows "Request failed with status code 404" | Accepted; fixed later (the significance score) |
| 6 | The map overlays (Fault Lines, Plate Boundaries) are listed in a different order on some pages | Accepted |
| 7 | Requests the frontend cancels itself, the same on both | Accepted |
| 8 | One comment's uploaded image isn't in the export | Accepted |
| 9 | No production event has an edited summary, so that page wasn't visited | Accepted |
| 10 | Under the browser tests, the PostgreSQL backend ran out of database connections while outside hosts couldn't be resolved | Fixed in the test setup; follow-up suggested |
| 11 | The developer `.env` points FDSN at production | Fixed in the test setup |

**1. "[object Object]" on earthquake pages with no place name: fixed.**

<p><img src="screenshots/findings/object-object-title-before-fix.jpg" width="600" alt="An earthquake page titled M4.8 Earthquake [object Object]"></p>

What was wrong:
- An earthquake page's title and summary fall back to the event's `location` when it has no place name. The frontend reads `location` as text.
- This branch added a GeoJSON `location` to every event for location queries (commit `6c677b6`, on `feat/db-refactor` before the PostgreSQL work), and the API started sending it. Production's events don't have it (the export has it on 0 of 906).
- So every event with no place name showed "[object Object]". That's 117 of the 906 production events (13%).
- Both backends sent it the same way, so comparing them didn't flag it. The browser test of an event with no place name did.

The fix: neither backend sends the stored point any more. It stays in the database for location queries. The pages now show the region name, as production does. Changed:
- `src/repositories/mongodb/events.repo.js` and `src/repositories/postgres/events.repo.js`
- 14 golden responses, which had recorded the point
- the API docs
- `POSTGRES.md`

**2. Fields only production has: accepted on dev, to handle before production.**

| Collection | Field | Records |
|---|---|---|
| accounts | `isActive`, `sessionVersion` | 20 |
| accounts | `adminNotificationPreferences` | 19 |
| accounts | `lastActivityAt` | 17 |
| accounts | `lastLoginAt` | 12 |
| comments | `moderationCase` | 1 |

- These fields come from the `admin-dashboard` branch, so production has run that code. Neither `dev` nor this branch has it.
- This branch on MongoDB doesn't read them. The PostgreSQL tables have no columns for them, so the copy leaves them out.
- On dev nothing uses them.
- Before production moves to PostgreSQL, the `admin-dashboard` work needs to be on this branch, with columns for these fields and a copy for them. Otherwise production loses them in the move.

**3. Two accounts with the same email, ignoring case: accepted on dev, to fix before production.**
- The accounts copy skips both and lists them by id, as `POSTGRES.md` describes.
- This branch's `migrate-unique-indexes` stops on them too, and changes nothing.
- They're the only accounts not copied: 90 of 92 accounts are in PostgreSQL.
- Before production is copied, the two need to be merged in MongoDB, or one of the emails changed.

**4. Device lists that point at missing devices: accepted.** 47 of the 110 entries in accounts' `devices[]` lists name devices that aren't in the export (removed devices). The copy can only link devices that exist, and it lists the rest. The API and the pages are the same on both backends.

**5. The significant earthquakes page: accepted.** The feature and its table were removed from the backend (the lead's decision). The frontend wasn't changed, so its page still calls the removed endpoint and shows the error. Same on both backends. *Fixed later:* the endpoints came back, with the list picked by a significance score instead of by hand (`POSTGRES.md`, "Significant earthquakes: the significance score"), so the unchanged page works again.

**6. Map overlays in another order: accepted.** The legend lists the overlays in the order their files finish loading. The files are static and read from disk, not the database, so the order changes from run to run on either backend.

**7. Requests the frontend cancels: accepted.** Both backends show the same two:
- The map asks for the fault lines, cancels that request, and asks again (it loads the second time).
- The live feed (`/messaging`) is closed when the page changes.

Separately, every request the test blocks (map tiles and other outside addresses) shows in the console as "Failed to load resource". How many depends on how much of the map was drawn, so the comparison checks which messages appear, not how many times.

**8. A missing uploaded image: accepted.** One production comment has an image file that lives on the server, not in the database export. Its image is broken on both backends.

**9. No edited summaries: accepted.** The page for an event with an edited summary was skipped: no production event has one. Editing and clearing a summary is covered by the API writes and the goldens.

**10. Database connections under the browser tests: fixed in the test setup, follow-up suggested.**
- What happened: with the developer `.env`, the backends looked up outside hosts that don't resolve outside production's network. Under the browser tests the PostgreSQL backend then failed requests with `KnexTimeoutError` (its connection pool was full).
- Why, most likely: the failing lookups queued up in Node's lookup threads. Opening a PostgreSQL connection needs a lookup too, so it waited behind them.
- The fix: the end-to-end backends now point every outside service at a dead local address. No timeouts since then, 0 in this run.
- Follow-up for production: if an outside host ever stops resolving there, the same could happen. Suggested: set `PG_HOST` to an IP address, or raise `UV_THREADPOOL_SIZE`.

**11. FDSN pointed at production: fixed in the test setup.** The developer `.env` sets the FDSN address to production's server. The end-to-end backends now override it, and every other outside service, with a dead local address. The comparisons were run again after the change, with the same results.

## Data: import and copy

Import (`scripts/e2e/import-prod-json.js`). Each file is one JSON array in Extended JSON (`$oid`, `$date`).

| Collection | Read | Imported | Rejected |
|---|---|---|---|
| accounts | 92 | 92 | 0 |
| devices | 26 | 26 | 0 |
| events | 906 | 906 | 0 |
| comments | 2 | 2 | 0 |
| contributionevents | 4 | 4 | 0 |

What the import found in the export:
- **Fields this branch added are missing on older records:**
  - `location`, on all 906 events and 26 devices
  - the password-policy fields, on most accounts
  - the per-catalog enrichment tracking, on 2 events

  This branch's MongoDB migrations fill them in, as deploying it would.
- **Fields only production has,** from the `admin-dashboard` branch (finding 2).
- **21 events store `legacyImportedAt` as text,** not a date.
- **One email clash, ignoring case** (finding 3). No username clashes.
- **References:** 47 device list entries point at missing devices (finding 4). Every comment's event and author, every points entry's account and event, and every event's station codes exist.

Copy to PostgreSQL (the real copy scripts, in order). Every copy's validation passed:

| Table | MongoDB | PostgreSQL | Copy report |
|---|---|---|---|
| accounts | 92 | 90 | 2 skipped (finding 3) |
| devices | 26 | 26 | 0 skipped |
| device releases | 0 | 0 | |
| brgy forwarding links | (in accounts) | 37 | 37 inserted |
| events | 906 | 906 | 0 skipped, 0 without a location |
| event stations | 6,548 | 6,548 | 0 unmatched, 0 ambiguous |
| event catalog matches | 1,204 | 1,204 | 0 unknown source, 0 duplicates |
| event catalog status | (in events) | 1,812 | one per event per catalog |
| comments | 2 | 2 | 0 skipped |
| helpful marks, issue reports | 0 | 0 | |
| contribution points | 4 | 4 | 0 skipped |

Links checked in PostgreSQL: 2 comments (event and author), 26 devices (owner), and 906 events (stations). None failed.

## API reads

`scripts/e2e/compare-api.js`: every read the frontend makes, for every record, on both backends, compared field by field.

**How strict the comparison is.** Each response is compared field by field: status code, every field present on both, the same types (a number is not a string, `null` is not a missing field) and exact values, including date formats and list order. Write flows normalize only what changes every run (new ids, this run's times, token signatures). Not compared: headers, which come from the same code on both backends, and key order, which the frontend doesn't depend on. New account and event ids are checked to be MongoDB-style (24 hex characters) by the integration tests.

| Endpoint | Requests | Identical | Documented differences only | Other differences |
|---|---|---|---|---|
| GET /eq-events (each event in the list) | 906 | 50 | 856 (`onlineStations` 2, `createdAt` 721, `__v` 682, `legacyImportedAt` 847, `legacySourcePublicID` 847, `candidateStations` 14, `catalogEnrichmentAttempts` 835, `catalogEnrichmentStatus` 2) | 0 |
| GET /eq-events (order) | 906 / 906 events | same order | | |
| GET /eq-events/:publicID | 906 | 50 | 856 (`onlineStations` 2, `createdAt` 721, `__v` 682, `legacyImportedAt` 847, `legacySourcePublicID` 847, `candidateStations` 14, `catalogEnrichmentAttempts` 835, `catalogEnrichmentStatus` 2) | 0 |
| GET /comments | 906 | 906 | 0 | 0 |
| GET /comments (by cursor) | 2 | 2 | 0 | 0 |
| GET /comments (by offset) | 2 | 2 | 0 | 0 |
| GET /device/all | 1 | 1 | 0 | 0 |
| GET /device/status | 26 | 26 | 0 | 0 |
| GET /accounts/ringserver-hosts | 1 | 1 | 0 | 0 |
| GET /accounts/profile | 3 | 3 | 0 | 0 |
| GET /device/my-devices | 3 | 3 | 0 | 0 |

The documented differences are the ones `POSTGRES.md` lists ("What the API shows differently after the switch"). The frontend reads none of them:
- `legacyImportedAt` and `legacySourcePublicID`: missing on old MongoDB records, `null` in PostgreSQL
- `createdAt` and `__v`: missing on old MongoDB records, always set in PostgreSQL
- `catalogEnrichmentAttempts` and `catalogEnrichmentStatus`: the copy turned the old single counter into one per catalog
- `candidateStations`: old records only had `onlineStations`
- `onlineStations`: the same stations, nearest first

## API writes

`scripts/e2e/compare-writes.js` runs every write flow the frontend and the sensors use. **49 steps: 49 the same on both backends, 0 different.**

| Flow | Steps |
|---|---|
| Accounts | register, sign in, profile, alert preferences, change username, email and password, sign out, forgot and reset password (through the mail catcher), sign in again, delete |
| Sensors | register an owner, link a sensor, station status as the ringserver sends it, my devices, unlink, link again, reset the link, delete the owner |
| Brgy | forward a sensor, the brgy's list, stop forwarding |
| Reports | post (text, anonymous, image only), list, mark helpful (twice), unmark, report an issue (twice), reject, delete, list again |
| Summary | edit, read, clear, read |
| SeisComP | a new event, its live-feed message, the event after its station check, an older update (dropped), a newer update, the event after |

Every step in detail follows.

How each step runs:
1. The same request goes to the MongoDB backend, then to the PostgreSQL backend.
2. Values that change on every run are normalized, as the goldens do:
    - sign-in tokens become what they say (username, role, account id)
    - this run's times become `<now>`
    - ids the run created become placeholders: `<new account id>`, `<new device id>`, `<new comment 1>`, `<uploaded image>`, `<new event id>`
3. The status code and the whole body are compared, as strictly as the reads.

The test data:
- **Throwaway accounts:** named `e2e_<run>`, with `@example.org` emails.
- **A made-up sensor:** a Raspberry Shake MAC address (`B8:27:EB:…`), with its station code derived from it.
- **The sample accounts from the import:**
  - the citizen posts reports and edits the summary
  - the sensor owner marks and flags the reports, as a second account
  - the brgy forwards the sensor
- **An admin session:** made with the backends' own signing secret, so no admin password is needed.
- **The earthquake:** reports and the summary go on the newest earthquake with no edited summary.
- **Cleanup:**
  - The accounts are deleted, the admin deletes the reports, and the summary is cleared.
  - The test earthquake (`e2e<run>`) stays, because the API can't delete earthquakes. The frontend tests skip it.

**Accounts** (12 steps)

| # | Step | Request | As | Status |
|---|---|---|---|---|
| 1 | Register a citizen | `POST /accounts/register` | signed out | 200 |
| 2 | Sign in, keeping the session cookie | `POST /accounts/authenticate` | the new account | 200 |
| 3 | Read the profile | `GET /accounts/profile` | the new account | 200 |
| 4 | Turn on sensor alert emails | `PATCH /accounts/alert-preferences` | the new account | 200 |
| 5 | Change the username (with the current password) | `PATCH /accounts/username` | the new account | 200 |
| 6 | Change the email | `PATCH /accounts/email` | the new account | 200 |
| 7 | Change the password | `PATCH /accounts/password` | the new account | 200 |
| 8 | Sign out | `POST /accounts/signout` | the new account | 200 |
| 9 | Ask for a password reset; the mail lands in Mailpit | `POST /accounts/forgot-password` | signed out | 200 |
| 10 | Reset the password with the link from that backend's own mail | `POST /accounts/reset-password` | signed out | 200 |
| 11 | Sign in with the new username and password | `POST /accounts/authenticate` | signed out | 200 |
| 12 | Delete the account | `DELETE /accounts` | the new account | 200 |

**Sensors and brgy forwarding** (13 steps)

| # | Step | Request | As | Status |
|---|---|---|---|---|
| 13 | Register the sensor's owner | `POST /accounts/register` | signed out | 200 |
| 14 | Link a new sensor: it sends its owner's username and password, MAC address, stream ID and coordinates, as a Raspberry Shake does, and gets back its tokens and alert credential | `POST /device/link` | the sensor | 200 |
| 15 | Report the station as streaming, as the ringserver does | `POST /messaging/restricted/station-status` | the ringserver | 200 |
| 16 | Read the station's status | `GET /device/status` | signed out | 200 |
| 17 | The owner's device list | `GET /device/my-devices` | the owner | 200 |
| 18 | Forward the sensor through the brgy: the brgy's ringserver checks the sensor's token | `POST /accounts/verify-sensor-token` | the brgy | 200 |
| 19 | The brgy's device list | `GET /device/my-devices` | the brgy | 200 |
| 20 | Stop forwarding | `POST /accounts/brgy/remove-device` | the sensor | 200 |
| 21 | Unlink the sensor | `POST /device/unlink` | the sensor | 200 |
| 22 | Link it again | `POST /device/link` | the sensor | 200 |
| 23 | Reset the link | `POST /device/reset-link` | the sensor | 200 |
| 24 | The full device list | `GET /device/all` | signed out | 200 |
| 25 | Delete the owner | `DELETE /accounts` | the owner | 200 |

After step 14 the sensor signs in with the `sensor` role and gets a token, as a Raspberry Shake does, and the owner signs in on the web. Those sign-ins are set-up, not compared steps.

**Reports** (14 steps)

| # | Step | Request | As | Status |
|---|---|---|---|---|
| 26 | Post a text report | `POST /comments` | the citizen | 201 |
| 27 | Post a report signed out (anonymous) | `POST /comments` | signed out | 201 |
| 28 | Post an image only (a 1×1 PNG) | `POST /comments` (file upload) | the citizen | 201 |
| 29 | List the earthquake's reports | `GET /comments` | signed out | 200 |
| 30 | Mark the first report helpful | `PUT /comments/:id/helpful` | the sensor owner | 200 |
| 31 | Mark it again: it still counts once | `PUT /comments/:id/helpful` | the sensor owner | 200 |
| 32 | Unmark it | `DELETE /comments/:id/helpful` | the sensor owner | 200 |
| 33 | Flag it as unclear | `POST /comments/:id/issues` | the sensor owner | 200 |
| 34 | Flag it again, as a duplicate | `POST /comments/:id/issues` | the sensor owner | 200 |
| 35 | Reject it | `PATCH /comments/:id/status` | the admin | 200 |
| 36–38 | Delete each of the 3 reports | `DELETE /comments/:id` | the admin | 200 |
| 39 | List the reports again | `GET /comments` | signed out | 200 |

**Earthquake summary** (4 steps)

| # | Step | Request | As | Status |
|---|---|---|---|---|
| 40 | Edit the summary | `PATCH /eq-events/:publicID/summary` | the citizen | 200 |
| 41 | Read the earthquake | `GET /eq-events/:publicID` | signed out | 200 |
| 42 | Clear the summary | `DELETE /eq-events/:publicID/summary` | the citizen | 200 |
| 43 | Read the earthquake | `GET /eq-events/:publicID` | signed out | 200 |

**SeisComP earthquake** (6 steps)

| # | Step | Request | As | Status |
|---|---|---|---|---|
| 44 | Send a new M4.6 earthquake, as the messaging proxy does | `POST /messaging/restricted/new-event` | SeisComP | 200 |
| 45 | The live-feed message each backend sent to open browsers | `GET /messaging` (opened before step 44) | signed out | |
| 46 | Read the earthquake once both backends have finished its station check (FDSN is unreachable on both) | `GET /eq-events/:publicID` | signed out | 200 |
| 47 | Send an update a minute older than the stored one (M3.0), which is dropped | `POST /messaging/restricted/new-event` | SeisComP | 200 |
| 48 | Send a newer update (M4.8) | `POST /messaging/restricted/new-event` | SeisComP | 200 |
| 49 | Read the earthquake: M4.8 on both | `GET /eq-events/:publicID` | signed out | 200 |

## Frontend

The browser tests (`e2e/frontend`, Playwright) ran the unchanged frontend once against each backend and compared what each page showed. **13 tests on each backend: 24 passed, 2 skipped** (the edited-summary page, finding 9). **16 pages recorded: 13 the same, 3 the same content in another order, 0 different.**

How each test runs:
1. **The browser:** Chromium opens the frontend's production build twice, once on the copy that talks to the MongoDB backend, then on the copy that talks to PostgreSQL.
    - Both runs use the same settings: a 1366×900 window, the Asia/Manila time zone, one test at a time.
2. **Blocked requests:** every request that isn't to localhost is blocked, such as map tiles and analytics. Nothing reaches production, and the map is blank on both runs.
3. **Recording:** after each page or action, the test lets the page settle, then records:
    - **the visible text.** Relative times ("5 minutes ago") and times within 30 minutes of the run are replaced by placeholders.
    - **a full-page screenshot.**
    - **the console errors.**
    - **the failed requests to the backend:** server errors, and requests that didn't complete. The removed endpoints and the dead sensor-feed address are left out.
4. **Blanking personal data:** before recording, the test blanks the sample accounts' and reporters' usernames, every email, and reporters' initials.
5. **Comparing:** `scripts/e2e/compare-frontend.js` compares the two runs page by page and gives each one a verdict:
    - **same:** the same text in the same order, with the same errors.
    - **same content, other order:** the same lines, but some moved.
    - **DIFF:** anything else.

The earthquakes are picked the same way on both runs, since the two event lists are identical. The test earthquake from the write flows is left out.

| # | Test | What it does | Signed in as | Pages recorded |
|---|---|---|---|---|
| 1 | Home | Opens `/` and waits for the map's legend | signed out | Home |
| 2 | Earthquake page: matched | Opens the first earthquake matched in both PHIVOLCS and USGS | signed out | Earthquake page: matched |
| 3 | Earthquake page: edited summary | Opens the first earthquake with an edited summary | signed out | skipped: none in the data (finding 9) |
| 4 | Earthquake page: legacy record | Opens the first record imported from the old catalog | signed out | Earthquake page: legacy |
| 5 | Earthquake page: no place name | Opens the first earthquake with no usable place name (finding 1) | signed out | Earthquake page: no place name |
| 6 | Earthquake page: with a report | Opens the first earthquake that has reports | signed out | Earthquake page: with a report |
| 7 | Significant earthquakes | Opens the removed `/significant-eqs` page, which shows 0 events and the 404 (finding 5) | signed out | Significant earthquakes |
| 8 | Reset password | Opens `/reset-password` with an invalid link; the page shows its new-password form | signed out | Reset password |
| 9 | Citizen | Signs in from the Account button, which opens the dashboard ("Your devices"), then opens Account settings | the citizen | Citizen: dashboard, account settings |
| 10 | Sensor owner | The same, ending on a dashboard with the device overview (streaming, not streaming, unlinked) | the sensor owner | Sensor owner: dashboard, account settings |
| 11 | Brgy | The same, ending on the "Managed devices" dashboard with the forwarded sensors | the brgy | Brgy: dashboard, account settings |
| 12 | Register | Fills in the registration form (email, username, password twice) and clicks "Create account". The frontend then asks for confirmation ("For contributors only"), and **the test stops there**: no account was created on either backend, and signing out wasn't reached | signed out | Register (the confirmation dialog) |
| 13 | Post a report, then mark it helpful | On the matched earthquake: <br>1. The citizen signs in and posts a text report. It's posted anonymously, the form's default, and appears in the list ("Showing 1 of 1 report"). <br>2. The sensor owner signs in and marks it helpful; the count shows 1. | the citizen, then the sensor owner | Post a report, Mark a report helpful |

Not tested in the browser:
- **Covered by the API write comparison instead:**
  - creating an account (test 12 stops before it)
  - posting an image, and reporting an issue
  - changing account settings, and deleting an account
  - linking a device
  - editing a summary
  - the live-feed message for a new earthquake (the browser's live update isn't tested)
- **Not covered by either:**
  - the home page's time range and filters
  - "load more" on reports (the data has only 2)
  - remote device actions

The verdict for each page:

| Page | Verdict | Console errors and failed requests (same on both) |
|---|---|---|
| Home: map and events panel | same content, other order (Fault Lines, Plate Boundaries) | `Failed to load resource: net::ERR_FAILED`<br>`GET /overlays/faults` |
| Earthquake page: matched in PHIVOLCS and USGS | same | `Failed to load resource: net::ERR_FAILED`<br>`Failed to load resource: net::ERR_UNSAFE_PORT` |
| Earthquake page: legacy record | same | `Failed to load resource: net::ERR_FAILED`<br>`Failed to load resource: net::ERR_UNSAFE_PORT` |
| Earthquake page: no place name | same | `Failed to load resource: net::ERR_FAILED`<br>`Failed to load resource: net::ERR_UNSAFE_PORT` |
| Earthquake page: with a report | same | `Failed to load resource: net::ERR_FAILED`<br>`Failed to load resource: net::ERR_UNSAFE_PORT` |
| Significant earthquakes (removed) | same | `Failed to load resource: net::ERR_FAILED`<br>`Failed to load resource: the server responded with a status of 404 (Not Found)`<br>`Error fetching significant EQs: AxiosError: Request failed with status code 404` |
| Reset password (an invalid link) | same | `Failed to load resource: net::ERR_FAILED` |
| Citizen: dashboard | same | `Failed to load resource: net::ERR_FAILED`<br>`GET /overlays/faults` |
| Citizen: account settings | same | `Failed to load resource: net::ERR_FAILED`<br>`GET /overlays/faults` |
| Sensor owner: dashboard | same | `Failed to load resource: net::ERR_FAILED`<br>`GET /overlays/faults` |
| Sensor owner: account settings | same | `Failed to load resource: net::ERR_FAILED`<br>`GET /overlays/faults` |
| Brgy: dashboard | same content, other order (Plate Boundaries, Fault Lines) | `Failed to load resource: net::ERR_FAILED`<br>`GET /overlays/faults` |
| Brgy: account settings | same content, other order (Plate Boundaries, Fault Lines) | `Failed to load resource: net::ERR_FAILED`<br>`GET /overlays/faults` |
| Register a new account (up to its confirmation dialog) | same | `Failed to load resource: net::ERR_FAILED`<br>`GET /overlays/faults` |
| Post a report | same | `Failed to load resource: net::ERR_FAILED`<br>`Failed to load resource: net::ERR_UNSAFE_PORT`<br>`GET /messaging` |
| Mark a report helpful (another account) | same | `Failed to load resource: net::ERR_FAILED`<br>`Failed to load resource: net::ERR_UNSAFE_PORT`<br>`GET /messaging` |

None of these comes from the backends:
- **`net::ERR_FAILED`:** the outside addresses the test blocks, such as map tiles.
- **`net::ERR_UNSAFE_PORT`:** the waveform and sensor feeds. The test points them at port 9, a dead local address, and the browser refuses that port.
- **`GET /overlays/faults` and `GET /messaging`:** requests the frontend cancels itself (finding 7).
- **The 404s:** the removed significant earthquakes endpoint (finding 5).

### Screenshots

MongoDB on the left, PostgreSQL on the right. Map tiles are blank on purpose: the tests block every outside address.

**Home: map and events panel**

<table><tr>
<td><img src="screenshots/mongodb/home.jpg" width="420" alt="Home: map and events panel, MongoDB"></td>
<td><img src="screenshots/postgres/home.jpg" width="420" alt="Home: map and events panel, PostgreSQL"></td>
</tr></table>

**Earthquake page: matched in PHIVOLCS and USGS**

<table><tr>
<td><img src="screenshots/mongodb/detail-withMatches.jpg" width="420" alt="Earthquake page: matched in PHIVOLCS and USGS, MongoDB"></td>
<td><img src="screenshots/postgres/detail-withMatches.jpg" width="420" alt="Earthquake page: matched in PHIVOLCS and USGS, PostgreSQL"></td>
</tr></table>

**Earthquake page: no place name**

<table><tr>
<td><img src="screenshots/mongodb/detail-noPlace.jpg" width="420" alt="Earthquake page: no place name, MongoDB"></td>
<td><img src="screenshots/postgres/detail-noPlace.jpg" width="420" alt="Earthquake page: no place name, PostgreSQL"></td>
</tr></table>

**Earthquake page: with a report**

<table><tr>
<td><img src="screenshots/mongodb/detail-withReports.jpg" width="420" alt="Earthquake page: with a report, MongoDB"></td>
<td><img src="screenshots/postgres/detail-withReports.jpg" width="420" alt="Earthquake page: with a report, PostgreSQL"></td>
</tr></table>

**Significant earthquakes (removed)**

<table><tr>
<td><img src="screenshots/mongodb/significant-eqs.jpg" width="420" alt="Significant earthquakes (removed), MongoDB"></td>
<td><img src="screenshots/postgres/significant-eqs.jpg" width="420" alt="Significant earthquakes (removed), PostgreSQL"></td>
</tr></table>

**Citizen: dashboard**

<table><tr>
<td><img src="screenshots/mongodb/dashboard-citizen.jpg" width="420" alt="Citizen: dashboard, MongoDB"></td>
<td><img src="screenshots/postgres/dashboard-citizen.jpg" width="420" alt="Citizen: dashboard, PostgreSQL"></td>
</tr></table>

**Citizen: account settings**

<table><tr>
<td><img src="screenshots/mongodb/account-settings-citizen.jpg" width="420" alt="Citizen: account settings, MongoDB"></td>
<td><img src="screenshots/postgres/account-settings-citizen.jpg" width="420" alt="Citizen: account settings, PostgreSQL"></td>
</tr></table>

**Sensor owner: dashboard**

<table><tr>
<td><img src="screenshots/mongodb/dashboard-sensorOwner.jpg" width="420" alt="Sensor owner: dashboard, MongoDB"></td>
<td><img src="screenshots/postgres/dashboard-sensorOwner.jpg" width="420" alt="Sensor owner: dashboard, PostgreSQL"></td>
</tr></table>

**Brgy: dashboard**

<table><tr>
<td><img src="screenshots/mongodb/dashboard-brgy.jpg" width="420" alt="Brgy: dashboard, MongoDB"></td>
<td><img src="screenshots/postgres/dashboard-brgy.jpg" width="420" alt="Brgy: dashboard, PostgreSQL"></td>
</tr></table>

**Post a report**

<table><tr>
<td><img src="screenshots/mongodb/report-posted.jpg" width="420" alt="Post a report, MongoDB"></td>
<td><img src="screenshots/postgres/report-posted.jpg" width="420" alt="Post a report, PostgreSQL"></td>
</tr></table>

## Coverage

Every backend call the frontend makes, and where it was compared:

| Frontend call | Tables | Reads | Writes | Pages | Goldens |
|---|---|---|---|---|---|
| `GET /eq-events`, `GET /eq-events/:id` | events, event stations, catalog matches and status | every event | yes | home, earthquake pages | yes |
| `PATCH`, `DELETE /eq-events/:id/summary` | events | | yes | | yes |
| `GET /comments`; `POST /comments`; `PUT`, `DELETE /comments/:id/helpful`; `POST /comments/:id/issues` | comments, helpful marks, issue reports, contribution points | every event | yes | reports | yes |
| `/accounts/*` (register, authenticate, signout, profile, username, email, password, alert-preferences, forgot-password, reset-password, delete) | accounts | profile | yes | sign-in, dashboards, account settings, register | yes |
| `GET /accounts/ringserver-hosts` | accounts | yes | | | yes |
| `POST /accounts/acquire-brgy-token` | accounts | | | brgy dashboard | yes |
| `GET /device/all`, `/device/status`, `/device/my-devices` | devices, brgy forwarding | every device | yes | home, dashboards | yes |
| `GET /device/remote-actions/capabilities`, `/servers` | devices | | | | yes |
| `POST /device/remote-actions/execute` | devices | | | | no: needs a device tunnel, which the test can't reach |
| `POST /device/add` | none | | | | yes: the route doesn't exist, 404 on both |
| `GET /messaging` (live feed) | events | | yes | every page | yes |
| `GET /overlays/*` | none (static files) | | | home | |
| `GET /significant-eqs/all` | removed | | | significant earthquakes page | |

Tables no frontend call reaches:
- `job_locks`: the background jobs' locks, covered by the Step 1 tests.
- `device_releases`: written when a device is unlinked. Covered by the unlink write steps and the goldens. Production has none.

## Re-run after Part 4

Part 4 removes MongoDB and the copy scripts. To re-run then:
1. Restore PostgreSQL from the saved baseline (`baseline/postgres.dump`).
2. Run only the PostgreSQL backend.
3. Compare its responses with `baseline/api-reads.json` and `baseline/api-writes.json`, the MongoDB responses saved in this run.

Results: *(to be added after Part 4)*
