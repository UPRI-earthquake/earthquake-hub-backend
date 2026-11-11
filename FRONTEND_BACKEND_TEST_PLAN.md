# Frontend + Backend Test Plan: PostgreSQL Backend

**Goal:** confirm that the frontend on `enhance/refactor` (the refactored Vite frontend) works with the backend on `feat/postgres-migration`. That backend runs on PostgreSQL only, with no MongoDB.

**This frontend has no screens for:** the significant earthquakes pages, the reset-password page, editing an event summary, or moderating reports. Those tests are API steps here, and the frontend dev checks the result where the frontend shows it. Two tests are expected to fail because of the frontend; see [Known frontend issues](#known-frontend-issues-on-enhancerefactor).

**Who:**
- The **frontend dev** drives the browser and judges what the pages show.
- The **backend dev** watches the backend log and the database, and runs the API calls that have no button in the frontend.

**What's already covered by automated checks:**
- The end-to-end check ([`docs/e2e/E2E_RESULTS.md`](docs/e2e/E2E_RESULTS.md)) compared every API read and 49 write steps between MongoDB and PostgreSQL. It also ran 13 browser tests. It found no unexplained differences.
- The backend's tests pass: 20 integration files with 453 tests, plus the unit tests.

This plan covers what those didn't: full flows by hand in a real browser, plus the pages that changed since. Rows marked **(new)** were never tested in a browser before.

**Focus: the database change.** Every test in sections A–G reads or writes data that moved from MongoDB to PostgreSQL, and its "Backend check" confirms the data landed in the right table. A few general checks that don't touch the database are kept apart, as optional, in [section H](#h-optional-checks-not-about-the-database).

---

## Contents

1. [Setup](#1-setup)
2. [How to run the tests](#2-how-to-run-the-tests)
3. [Test cases](#3-test-cases)
4. [Backend checks during the session](#4-backend-checks-during-the-session)
5. [Known differences: not bugs](#5-known-differences-not-bugs)
6. [Clean-up](#6-clean-up)
7. [Results and sign-off](#7-results-and-sign-off)

---

## 1. Setup

### Backend dev

1. Check out `earthquake-hub-backend` on `feat/postgres-migration`, at `5d5dcd0` or later.
2. In `.env`, take the keys from `.env.example` and set `PG_PASSWORD`. No `MONGO_*` keys are needed.
3. Point the backend's mail at Mailpit on your machine: set `EMAIL_HOST=host.docker.internal` in `.env`, then start Mailpit:
   ```sh
   docker run --rm -p 1025:1025 -p 8025:8025 axllent/mailpit    # inbox: http://localhost:8025
   ```
   Inside the backend container, `localhost` means the container itself.
4. Start the backend and apply the migrations:
   ```sh
   docker compose up -d
   npm run db:pg:migrate
   ```
5. Check the start-up log with `docker logs earthquake-hub-backend-dev`. You should see:
   - six `[db] ...: postgres` lines
   - `[db] MongoDB: not used (every area is on PostgreSQL)`
   - `Connected to PostgreSQL ...`
6. Load the test data: `npm run db:pg:seed` ([`POSTGRES.md`, 1.4](POSTGRES.md#14-load-test-data)). It adds dev's 906 earthquakes and these test accounts, all with the password `Qa-Password-2026!`:
   - `qa_citizen_1` and `qa_citizen_2` (citizens)
   - `qa_sensor_owner` (a citizen with three test sensors)
   - `qa_brgy` (an approved brgy, forwarding two of those sensors)

   You don't need anyone's data: the seed is in the repo, and it has no personal data. On a database that already has data, it adds only what's missing.
7. Get an admin token for the steps marked **(API, admin)** (see [Admin token](#admin-token) below):
   ```sh
   docker exec -w /app earthquake-hub-backend-dev node -r dotenv/config -e "process.stdout.write(require('./src/controllers/helpers').generateAccessToken({ accountId: '6f00000000000000000000ad', username: 'qa_admin', role: 'admin' }, 'web'))"
   ```

### Frontend dev

1. Check out `earthquake-hub-frontend` on `enhance/refactor`, at `f2c1f97` or later. Make no changes for this test.
2. In the frontend's `.env`, set `VITE_APP_BACKEND=http://localhost:5000`.
3. Run `npm install`. It ends with `patch-package` reporting an error for `react-scripts`: ignore it (the refactor removed `react-scripts` but not its old patch).
4. Run `npm run dev` (not `npm start`, which needs a script the branch doesn't have) and open **http://localhost:3000**. The backend accepts requests only from that exact origin (CORS).
5. Keep DevTools open on the **Console** and **Network** tabs for every test.

### Admin token

The frontend has no admin screens, so admin steps are API calls. Send the token from setup step 7 as a cookie:

```sh
curl ... -H 'Cookie: accessToken=<admin token>'
```

### Test data rules

- Use the **seeded test accounts** (setup step 6), and name any account you create `qa_<role>_<n>` with an `@example.org` email. Never sign in as a real person's account.
- Name test earthquakes `qa...` (e.g. `qa2026live01`) so they're easy to remove.
- Remove everything at the end ([section 6](#6-clean-up)).

---

## 2. How to run the tests

- Go through the tables in order. The frontend dev drives the browser; the backend dev runs the API calls marked **(API)** and checks the **Backend check** column.
- **Pass** means all of these:
  - the page does what "Expected" says
  - the Network tab has no failed request except those in [section 5](#5-known-differences-not-bugs)
  - the backend log has no `500` or `KnexTimeoutError`
- Record each row's result in [section 7](#7-results-and-sign-off). For a failure, record the steps, what you expected and what happened, a screenshot, the failing request (URL, status, response), and the backend log lines around it.
- **P1** rows must pass before sign-off. **P2** rows can be signed off with a noted problem.

---

## 3. Test cases

### A. Home and map

| ID | P | Steps | Expected | Backend check |
|---|---|---|---|---|
| A1 | P1 | Open `/` | The map, events panel and legend load. The list covers the last 30 days. On a freshly seeded database that's **empty** (the newest seeded earthquake is from 25 Sep 2026), so the empty state shows. A2 widens the range. | `GET /eq-events?startTime=<30 days ago>&endTime=<today>` 200 |
| A2 | P1 | **(new)** Change the time range and the filters, including a range with no events | The list and the map follow each change; an empty range shows the empty state | One `GET /eq-events` per change, all 200 |
| A3 | P1 | **(new)** Keep the home page open. **(API)** Post a test earthquake (command below). Then reload. | It appears on the map and in the list **without a reload** (live feed). **Expected to fail on this frontend** ([known issue 1](#known-frontend-issues-on-enhancerefactor)); after the reload it must be listed. | 200 "New event sent to SSE and added to DB"; row in `events` |
| A4 | P2 | **(API)** Post an *older* update of the same earthquake: same `publicID`, earlier `last_modification`, magnitude 3.0 | Nothing changes on the page; the newer magnitude stays | `events.magnitude` unchanged |

Post a test earthquake (A3). For A4, send it again with `"magnitude_value": 3.0` and `"last_modification": "<an earlier time>"`:

```sh
curl -X POST http://localhost:5000/messaging/restricted/new-event -H 'Content-Type: application/json' -d '{
  "publicID": "qa2026live01", "OT": "<now, ISO>", "latitude_value": 14.62, "longitude_value": 121.1,
  "depth_value": 12, "magnitude_value": 4.6, "eventType": "NEW", "method": "automatic",
  "text": "Luzon, Philippines", "last_modification": "<now, ISO>"}'
```

### B. Earthquake detail page

| ID | P | Steps | Expected | Backend check |
|---|---|---|---|---|
| B1 | P1 | Open an earthquake from the list or map | The title, place, magnitude, depth, local time and PHIVOLCS/USGS matches show | `GET /eq-events/<publicID>` 200 |
| B2 | P1 | Open an earthquake with no place name | It shows the region name, never "[object Object]" (E2E finding 1, fixed) | |
| B3 | P2 | Open a legacy record (imported from the old catalog) | It opens normally | |
| B5 | P1 | **(new)** **(API, admin)** Edit the event summary (command below), reload the detail page, then revert it and reload | The edited summary shows after the reload. Reverting brings back the generated summary. | `PATCH` / `DELETE /eq-events/<publicID>/summary` 200; `events.summary_override_text` |

Edit and revert a summary (B5, F5):

```sh
curl -X PATCH http://localhost:5000/eq-events/<publicID>/summary -H 'Content-Type: application/json' -H 'Cookie: accessToken=<admin token>' -d '{"text":"QA test summary"}'
curl -X DELETE http://localhost:5000/eq-events/<publicID>/summary -H 'Cookie: accessToken=<admin token>'
```

### C. Reports

Use the seeded citizens `qa_citizen_1` and `qa_citizen_2`.

| ID | P | Steps | Expected | Backend check |
|---|---|---|---|---|
| C1 | P1 | As `qa_citizen_1`, post a text report, once named and once anonymous | Both appear. The named one shows the username; the other shows "Anonymous". | `POST /comments` 201; rows in `comments`; `contribution_events` has `report_posted` |
| C2 | P1 | **(new)** Post a report with only an image | The image shows in the report | Row with `image_url`; the file is in the upload folder |
| C3 | P1 | As `qa_citizen_2`, mark citizen 1's report helpful, unmark it, then mark it again | The count goes 1 → 0 → 1. Marking your own report isn't possible. | One `report_marked_helpful` and one `report_received_helpful` in `contribution_events` (not duplicated) |
| C4 | P1 | **(new)** As `qa_citizen_2`, report an issue on the report, then report again with another reason | Both are accepted | One row in `comment_issue_reports`, with the latest reason |
| C5 | P2 | **(new)** "Load more" on an event with more reports than the first page shows. **(API)** Post about 15 reports on one test event first. | The next page loads, without repeats or gaps | `GET /comments?...&cursor=` 200 |
| C6 | P1 | **(new)** **(API, admin)** Reject one report, then delete another (commands below); reload the earthquake page | The rejected one disappears from the list; the deleted one is gone | `PATCH /comments/<id>/status`, `DELETE /comments/<id>` 200 |

Reject and delete a report (C6). `<id>` is the report's `comment_id` (section 4's query lists them):

```sh
curl -X PATCH http://localhost:5000/comments/<id>/status -H 'Content-Type: application/json' -H 'Cookie: accessToken=<admin token>' -d '{"status":"rejected"}'
curl -X DELETE http://localhost:5000/comments/<id> -H 'Cookie: accessToken=<admin token>'
```

### D. Accounts

| ID | P | Steps | Expected | Backend check |
|---|---|---|---|---|
| D1 | P1 | **(new)** Register `qa_citizen_3`: fill in the form, click "Create account", **confirm the dialog**, and finish | The account is created and signed in, or a sign-in follows that works. (The E2E browser test stopped at the dialog.) | `POST /accounts/register` 200; row in `accounts` |
| D2 | P1 | Sign in by username, then by email | Both work | `POST /accounts/authenticate` 200 |
| D3 | P2 | Sign in by username in a different case, e.g. `QA_CITIZEN_3` | **Works now** (section 5) | |
| D4 | P1 | Sign in with a wrong password | A clear error, and no session | 401 |
| D5 | P1 | **(new)** Forgot password → the email arrives in Mailpit. Its link opens Not Found on this frontend ([known issue 2](#known-frontend-issues-on-enhancerefactor)), so **(API)** set a new password with the link's `token` (command below), then sign in with it in the app. Send the same token again. | The new password works, and the reused token is refused | `POST /accounts/forgot-password` 200, `/reset-password` 200 then 4xx |

Set a new password (D5). `<token>` is everything after `token=` in the email's link:

```sh
curl -X POST http://localhost:5000/accounts/reset-password -H 'Content-Type: application/json' \
  -d '{"token":"<token>","password":"Qa-Password-2026!new","confirmPassword":"Qa-Password-2026!new"}'
```
| D6 | P1 | **(new)** Account settings: change the username, email, password and alert preferences, reloading after each | Each change is saved and stays after a reload | `PATCH /accounts/...` 200 |
| D7 | P1 | Sign out, then sign back in | Signed out cleanly; signing in works again | |
| D9 | P1 | **(new)** Delete `qa_citizen_3` (no devices) | It's deleted, and signing in with it fails | `DELETE /accounts` 200 |
| D10 | P2 | Sign in as `qa_brgy` (seeded) | The "Managed devices" dashboard loads, with the two forwarded test sensors (on a freshly seeded database) | |

### E. Sensors and devices

The sensor software links devices, not the frontend. The backend dev does the linking through the API, and the frontend dev checks the dashboard.

| ID | P | Steps | Expected | Backend check |
|---|---|---|---|---|
| E1 | P1 | **(API)** Link a test device to `qa_citizen_1` (commands below); then, as `qa_citizen_1`, open the dashboard | The device appears under "Your devices" | `POST /device/link` 200; row in `devices` |
| E2 | P1 | **(API)** Send a station status of `streaming`, then `not streaming` | The dashboard shows each status after a refresh | `POST /messaging/restricted/station-status` 200 |
| E3 | P1 | **(API)** Unlink the device | It leaves "Your devices", and the release history shows it | `POST /device/unlink` 200; row in `device_releases` |
| E4 | P1 | Try deleting `qa_citizen_1` while a device is linked | Refused, with a clear message | `DELETE /accounts` 409 |
| E5 | — | Remote device actions | **Not testable in dev:** they need the tunnel/bastion servers | |

Device commands. Run them in `earthquake-hub-backend`; the station code comes from the MAC address:

```sh
docker exec -w /app earthquake-hub-backend-dev node -e "console.log(require('./src/controllers/helpers').generateAMStationCode('B8:27:EB:12:AB:CD'))"
# link (as the sensor software does):
curl -X POST http://localhost:5000/device/link -H 'Content-Type: application/json' -d '{"username":"qa_citizen_1","password":"Qa-Password-2026!","role":"sensor","elevation":"55","latitude":"14.64","longitude":"121.06","macAddress":"B8:27:EB:12:AB:CD","streamId":"AM_<station>_.*/MSEED"}'
# station status:
curl -X POST http://localhost:5000/messaging/restricted/station-status -H 'Content-Type: application/json' -d '{"network":"AM","station":"<station>","status":"streaming"}'
# unlink: sign in as the sensor, then send its token
TOKEN=$(curl -s -X POST http://localhost:5000/accounts/authenticate -H 'Content-Type: application/json' -d '{"username":"qa_citizen_1","password":"Qa-Password-2026!","role":"sensor"}' | node -pe "JSON.parse(require('fs').readFileSync(0)).accessToken")
curl -X POST http://localhost:5000/device/unlink -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"macAddress":"B8:27:EB:12:AB:CD","streamId":"AM_<station>_.*/MSEED"}'
```

### F. Significant earthquakes (new: picked by the significance score)

The list is no longer picked by hand. A score picks it from the earthquakes: [`POSTGRES.md`, "Significant earthquakes: the significance score"](POSTGRES.md#significant-earthquakes-the-significance-score).

**API only:** `enhance/refactor` has no significant earthquakes pages ([known issue 3](#known-frontend-issues-on-enhancerefactor)). The backend dev runs these with the commands below.

| ID | P | Steps | Expected | Backend check |
|---|---|---|---|---|
| F1 | P1 | **(API)** Get the list | 16 entries on the seeded data, highest `significance` first, starting with "M7.8 Earthquake, 24 km SW of Soccsksargen, Philippines" | `GET /significant-eqs/all` 200 |
| F2 | P1 | **(API)** Get one entry by its `_id` | 200 with `title`, `magnitude`, `depth`, `location`, `eventTime`, `eventSummary`, and empty `instrumentRecordings` and `references` | `POST /significant-eqs` 200 |
| F3 | P1 | **(API, admin)** Set recordings and references on that earthquake, then get it again | Both lists come back as set | `PUT /significant-eqs/<_id>/details` 200; row in `significant_eq_details` |
| F4 | P1 | **(API, admin)** Remove them, then get it again | Both lists are empty again | `DELETE .../details` 200; row gone |
| F5 | P1 | **(API, admin)** Edit the summary of a listed earthquake (B5's command), then get the list again | That entry's `eventSummary` is the edited text. Revert it afterwards. | |
| F6 | P2 | **(API)** Get `{"id":"abc"}`, then an unknown 24-character id | 400, then 404 | |

Commands (F1–F4, F6). `<_id>` is an entry's `_id` from F1:

```sh
curl http://localhost:5000/significant-eqs/all
curl -X POST http://localhost:5000/significant-eqs -H 'Content-Type: application/json' -d '{"id":"<_id>"}'
curl -X PUT http://localhost:5000/significant-eqs/<_id>/details -H 'Content-Type: application/json' -H 'Cookie: accessToken=<admin token>' \
  -d '{"instrumentRecordings":["R3B2D","R1382"],"references":["https://earthquake.phivolcs.dost.gov.ph/"]}'
curl -X DELETE http://localhost:5000/significant-eqs/<_id>/details -H 'Cookie: accessToken=<admin token>'
curl -X POST http://localhost:5000/significant-eqs -H 'Content-Type: application/json' -d '{"id":"abc"}'
curl -X POST http://localhost:5000/significant-eqs -H 'Content-Type: application/json' -d '{"id":"000000000000000000000000"}'
```

### G. Database connections under load

| ID | P | Steps | Expected | Backend check |
|---|---|---|---|---|
| G3 | P1 | **(new)** Load the home page with the widest time range, then keep using the app for 2–3 minutes: open earthquakes, post a report | No slowdowns or failures. This checks the fix for the database-connection stall that a full event list used to cause. | No `KnexTimeoutError` in the log |

### H. Optional checks: not about the database

General checks that the app still works. They don't touch the moved data, so skip them if the session is only about the database.

| ID | Steps | Expected |
|---|---|---|
| A5 | Turn the map overlays (fault lines, plate boundaries) on and off | They draw and hide. Their order in the menu may differ (section 5). |
| A6 | ~~Open the "Significant Earthquakes" floating button on the home page~~ | N/A: not on `enhance/refactor` |
| B4 | On an earthquake with recording stations, open a station's Metadata and Waveform | The buttons respond. Live feeds may fail in dev (section 5). |
| D8 | Keep a session open, restart the backend (`docker restart earthquake-hub-backend-dev`), then use the page | Still signed in; requests work once the backend is back up |
| G1 | ~~Open `/reset-password?token=invalid` and submit~~ | N/A: no reset-password page on `enhance/refactor`. D5 sends a used token, which covers the 4xx. |
| G2 | Open an unknown path, e.g. `/nope` | The not-found page |
| G4 | Restart the backend with the home page open | The page recovers, and the live feed reconnects |

---

## 4. Backend checks during the session

Keep the log open the whole time:

```sh
docker logs -f earthquake-hub-backend-dev    # watch for 500, KnexTimeoutError, "Server error occurred"
```

Look at the rows each write should leave, in pgAdmin or psql (`docker exec -it earthquake-hub-postgres psql -U ehub -d earthquake_hub`):

```sql
SELECT username, email, created_at FROM accounts WHERE username LIKE 'qa\_%';
SELECT c.comment_id, c.username, c.status, e.public_id FROM comments c JOIN events e ON e.id = c.event_id ORDER BY c.created_at DESC LIMIT 20;
SELECT a.username, ce.action_type, ce.points FROM contribution_events ce JOIN accounts a ON a.id = ce.account_id WHERE a.username LIKE 'qa\_%';
SELECT network, station, activity, status FROM devices ORDER BY updated_at DESC LIMIT 5;
SELECT * FROM significant_eq_details;
```

---

## 5. Known differences: not bugs

| What you'll see | Why |
|---|---|
| `POST /notifications/subscribe` → **404**; allowing notifications does nothing | Push notifications were removed from the backend. The frontend still has the code. |
| Sign-in accepts a username in any case (`QA_CITIZEN_1`) | PostgreSQL compares usernames case-insensitively, as it already did for emails. MongoDB was case-sensitive. |
| Map overlays listed in a different order on some pages | E2E finding 6. Same content. |
| Cancelled requests (`GET /overlays/faults`, `GET /messaging`) in Network | The frontend cancels them itself (E2E finding 7) |
| In dev: places "Unavailable", or region names instead of "N km of ..." | Dev can't reach GeoServe |
| In dev: errors for live waveforms or sensor feeds; backend log "Error connecting to /sse-connections" | Dev can't reach the sensors or the ringserver |
| The significant earthquakes list differs from the old hand-picked one | It's chosen by the score now. The old summaries, recordings and references are carried over only by the copy script, and dev had none. |
| To admins, a report by a deleted account shows no `accountId` | PostgreSQL removes the link when the account is deleted. MongoDB kept the old id. |
| `POST /device/add` → **404** if you add a device from the dashboard | The backend has no such route. The old frontend made the same call; not part of this plan. |

### Known frontend issues on `enhance/refactor`

Problems in the refactored frontend, not the backend. Record the affected rows as **Fail (frontend)**, still do their backend checks, and pass the issue to the frontend dev.

1. **The live feed doesn't add a new earthquake (A3).** In `src/features/map/data/local/EarthquakesDataHandler.ts`, `receiveEarthquakeFromStream` uses `if(existingIndex)`. `findIndex` returns `-1` for a new earthquake, and `-1` counts as true, so the new earthquake is never added. And an update to the earthquake at index 0 adds a second copy instead of replacing it. A new earthquake appears only after a reload.
2. **No reset-password page (D5, G1).** The reset email links to `/reset-password?token=...`, which opens Not Found.
3. **No significant earthquakes pages (section F, A6).** `/significant-eqs` and `/significant-eq-info` were removed, and the floating button that opens them isn't shown.
4. **No admin screens (B5, C6).** Summaries can't be edited and reports can't be moderated in the app. The detail page still shows an edited summary.

---

## 6. Clean-up

The backend dev does this at the end:

1. Delete the accounts created during the test, such as `qa_citizen_3` if D9 didn't: in the app, or with `DELETE /accounts` and its session. Their points go with them. The seeded `qa_` accounts can stay; if one was deleted, `npm run db:pg:seed` adds it back.
2. Delete the test earthquakes and their reports:
   ```sql
   DELETE FROM events WHERE public_id LIKE 'qa%';   -- their comments, stations and details go with them
   ```
3. Revert any summary you edited (B5, F5), and remove any significant earthquake details (F3).
4. Check the counts are back to where they started (906 events; 4 accounts on a freshly seeded database, or 85 on the old dev data):
   ```sql
   SELECT (SELECT count(*) FROM events) AS events, (SELECT count(*) FROM accounts) AS accounts,
          (SELECT count(*) FROM comments) AS comments, (SELECT count(*) FROM significant_eq_details) AS details;
   ```
5. Stop Mailpit.

---

## 7. Results and sign-off

| ID | Result (Pass / Fail / N/A) | Tester | Notes / issue link |
|---|---|---|---|
| A1 | | | |
| A2 | | | |
| A3 | | | |
| A4 | | | |
| B1 | | | |
| B2 | | | |
| B3 | | | |
| B5 | | | |
| C1 | | | |
| C2 | | | |
| C3 | | | |
| C4 | | | |
| C5 | | | |
| C6 | | | |
| D1 | | | |
| D2 | | | |
| D3 | | | |
| D4 | | | |
| D5 | | | |
| D6 | | | |
| D7 | | | |
| D9 | | | |
| D10 | | | |
| E1 | | | |
| E2 | | | |
| E3 | | | |
| E4 | | | |
| E5 | N/A (dev) | | needs the tunnel/bastion servers |
| F1 | | | |
| F2 | | | |
| F3 | | | |
| F4 | | | |
| F5 | | | |
| F6 | | | |
| G3 | | | |
| *Optional (section H):* A5, A6, B4, D8, G1, G2, G4 | | | |

**Signed off when** every P1 row passes, and each failure has an issue with an owner (frontend or backend).

| | Name | Date |
|---|---|---|
| Frontend dev | | |
| Backend dev | | |
