# Database schema

The backend's data is in **PostgreSQL 18 with PostGIS 3.6**. The schema is whatever the Knex migrations in [`src/db/migrations/`](src/db/migrations/) build; this page describes the tables and the rules they enforce. Setting up PostgreSQL, running migrations and the rest are in [`POSTGRES.md`](POSTGRES.md).

Until Phase 4 the data was in MongoDB. It moved one area at a time, and the MongoDB code was removed afterwards ([`POSTGRES.md`, section 6](POSTGRES.md#6-history-the-move-from-mongodb)). Some columns still show that history:
- Every table's key is a `uuid` (`uuidv7()`), used only inside PostgreSQL.
- Rows that clients name (accounts, devices, events, comments, points) also have `legacy_mongo_id`, a MongoDB-style id. It's what the API shows, for rows copied from MongoDB and for new ones alike ([`POSTGRES.md`, "Ids the API shows"](POSTGRES.md#ids-the-api-shows-mongodb-style)).

## Diagram

[`docs/postgres-schema.dbml`](docs/postgres-schema.dbml) is the schema in [DBML](https://dbml.dbdiagram.io): every enum, table, column, index, check rule and foreign key, with its `ON DELETE` rule. Paste it into [dbdiagram.io](https://dbdiagram.io) to see the diagram.

It's generated from a migrated database, so don't edit it by hand. After a migration changes the schema, regenerate it against a database migrated to the latest version (e.g. your dev one):

```sh
npm run db:pg:migrate
npm run db:pg:dbml > docs/postgres-schema.dbml
```

## Tables

| Table | Replaces (MongoDB) | Migration |
|---|---|---|
| `job_locks` | `joblocks` | `20261022000100_create_job_locks.js` |
| `accounts` | `accounts` | `20261026000000_create_accounts.js` |
| `devices` | `devices` (and `accounts.devices[]`) | `20261026000100_create_devices.js` |
| `device_releases` | `accounts.releasedDevices[]` | `20261026000200_create_device_releases.js`, `20261028000000_add_device_legacy_id_to_device_releases.js` |
| `brgy_forwarded_devices` | brgy accounts' `devices[]` | `20261027000000_create_brgy_forwarded_devices.js` |
| `events` | `events` | `20261029000000_create_events.js` |
| `event_stations` | `events.candidateStations[]`, `recordingStations[]` | `20261029000100_create_event_stations.js` |
| `event_catalog_matches` | `events.additionalInformation[]` | `20261029000200_create_event_catalog_matches.js`, `20261030000000_add_position_to_event_catalog_matches.js` |
| `event_catalog_status` | `events.pendingCatalogSources`, `catalogEnrichment*`, legacy `upForEnrichment` | `20261029000300_create_event_catalog_status.js` |
| `comments` | `comments` | `20261104000000_create_comments.js` |
| `comment_helpful_marks` | `comments.helpfulAccountIds[]` | `20261104000100_create_comment_helpful_marks.js` |
| `comment_issue_reports` | `comments.issueReports[]` | `20261104000200_create_comment_issue_reports.js` |
| `contribution_events` | `contributionevents` | `20261104000300_create_contribution_events.js` |
| `significant_eq_details` | `significant-eqs` (its hand-written recordings and references) | `20261111000000_create_significant_eq_details.js` |

The backend uses all fourteen tables. Production still runs on MongoDB until its own move. `significant_eqs` (migrations `20261023000000`, `20261029000400`), which held the hand-picked list, was dropped by `20261105000000`. Significant earthquakes came back without a stored list: the significance score picks them from `events`, and `significant_eq_details` holds only what admins add ([`POSTGRES.md`, "Significant earthquakes"](POSTGRES.md#significant-earthquakes-the-significance-score)).

Every table with an `updated_at` column keeps it current with the `set_updated_at()` trigger: every update gets the current time. A transaction that sets `app.preserve_updated_at = 'on'` keeps the value it writes instead: the copy from MongoDB did, so a copied row kept MongoDB's `updated_at` (migration `20261026000300`).

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
| `legacy_mongo_id` | `char(24)`, unique | MongoDB `_id` of a copied row, or a new ObjectId for an account created here: the id session tokens carry ([ids the API shows](POSTGRES.md#ids-the-api-shows-mongodb-style)) |
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

Usernames were case-sensitive in MongoDB, so `Juan` and `juan` could both exist there. Such pairs can't both be in PostgreSQL: the copy skipped and listed them for the team to resolve (production has one email clash: [`docs/e2e/E2E_RESULTS.md`](docs/e2e/E2E_RESULTS.md), finding 3).

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

**A device that earthquake history lists can't be deleted** (`event_stations`, `ON DELETE RESTRICT`), so `POST /device/reset-link` keeps such a device instead: it removes it from every account as before, and clears its stream ID, MAC address and alert credential (activity `unlinked`). The history keeps its station, and linking the sensor again takes the same record back, for whichever account links it: a link that finds no device with that MAC reuses a cleared device with the same network and station, after the usual check that an AM station code belongs to that MAC. A device without history is still deleted.

### `device_releases`

One row each time an account unlinked a device, with a snapshot of the device at that moment (replaces `accounts.releasedDevices[]`).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid`, primary key | |
| `legacy_mongo_id` | `char(24)`, unique | `_id` of the MongoDB `releasedDevices[]` entry a copied row came from |
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
| `source` | `catalog_source` enum | `phivolcs`, `usgs`, or `upri-legacy` (the old UPRI catalog's entry on imported records, which the frontend shows) |
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
