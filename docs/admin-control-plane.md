# Admin control-plane developer guide

Last reviewed: 2026-08-04

The hub backend is the authoritative browser-facing backend for the
EarthquakeHub Admin Console. Public nginx maps `/api/admin/*` to the Express
`/admin/*` routes mounted in `src/app.js`. The separate
`earthquake-hub-admin-backend` is a private read-only telemetry adapter and is
never called by the browser.

## Why the control plane lives here

Admin workflows modify or aggregate application-owned Accounts, Devices,
Events, Community Reports, and MongoDB records. Keeping these APIs in the hub
backend reuses the existing identity, domain validation, and persistence rules.
It also prevents a host-bound adapter from becoming a second business backend.

This process must not receive a Docker socket, host PID namespace, host root,
SeisComP command credentials, arbitrary host paths, or unrestricted shell/log
access. Fixed host evidence is requested through
`src/services/adminHostTelemetry.client.js` over the private mTLS network.

## Request security pipeline

Read routes require:

1. access token extraction from the HttpOnly cookie;
2. persisted account/session validation;
3. the existing `admin` domain role.

Mutation routes add, as applicable:

1. session-bound CSRF cookie/claim/header validation;
2. server-side action capability and admin-tier authorization;
3. recent authentication for high-risk account security changes;
4. exact target confirmation for destructive or privilege-changing actions;
5. schema and expected-current-state validation;
6. immutable audit `started`, then `succeeded` or `failed` lifecycle records.

Rejected capability, recent-authentication, typed-confirmation, and selected
authentication failures are audited as `rejected`. The submitted confirmation
value, passwords, tokens, cookies, and response bodies are not audit metadata.

Key implementation files:

- `src/middlewares/token.middleware.js`
- `src/middlewares/adminCsrf.middleware.js`
- `src/middlewares/adminSession.middleware.js`
- `src/middlewares/adminActionPolicy.middleware.js`
- `src/services/adminCapabilities.service.js`
- `src/services/auditLog.service.js`

See [`admin-action-capabilities.md`](admin-action-capabilities.md) for every
action switch and privilege tier.

## Browser API map

All paths below are shown as browser-visible `/api/admin/*` paths. Route files
use the equivalent `/admin/*` path internally.

### Session and shared reads

| Method and path | Behavior | Implementation |
| --- | --- | --- |
| `POST /authenticate` | Rate-limited admin login, cookie and CSRF issuance, auth audit | `admin.route.js`, `admin.controller.js`, `adminAuthAudit.service.js` |
| `GET /profile` | Session validation, profile, capability document | `admin.route.js`, `admin.controller.js` |
| `POST /signout` | Clears admin session cookies; tolerates an already-invalid session | `admin.route.js`, `admin.controller.js` |
| `GET /search?q=&limit=` | Bounded federated Stations/Accounts/Reports/Events search with partial-source results | `adminGlobalSearch.route.js`, `adminGlobalSearch.service.js` |
| `GET /overview/snapshot` | Cached, independently bounded operational aggregate and incident reconciliation | `adminOverview.route.js`, `adminOverview.service.js` |
| `GET /system/snapshot` | Normalized CPU/Memory/Disk telemetry and gated host capability boundary | `adminSystem.route.js`, `adminSystem.service.js` |

Authentication is rate-limited by both source IP and normalized identifier.
Global search is rate-limited and executes existing domain services
concurrently; it does not maintain a duplicate search database.

### Operational incidents

| Method and path | Behavior |
| --- | --- |
| `GET /incidents` | Bounded incident list for supported filters |
| `GET /incidents/:incidentId/events` | Append-only lifecycle and note history |
| `PATCH /incidents/:incidentId` | Acknowledge, investigate, resolve, reopen, assign, or unassign |
| `POST /incidents/:incidentId/notes` | Append an operator investigation note |

Overview conditions are deduplicated by a stable fingerprint. Active incidents
never expire. Resolving assigns policy-specific absolute expiry; recurrence
reopens the same incident and removes its expiry. This design preserves a
single investigation identity across intermittent evidence.

### Persistent admin jobs

| Method and path | Behavior |
| --- | --- |
| `GET /jobs` | Cursor/filter list of bounded job summaries |
| `GET /jobs/:jobId` | One job with progress, result/failure, timing, and retry lineage |
| `POST /jobs/:jobId/retry` | Authorized retry of a retryable terminal job |
| `POST /earthquake-events/enrichment/run` | Queue the fixed catalog-enrichment job |
| `POST /earthquake-events/recording-availability/run` | Queue the fixed recent-event FDSNWS verification job |

The browser sends an `Idempotency-Key`, but cannot choose a job type, URL,
command, worker, lease, or timeout. A sparse unique `activeKey` prevents
concurrent active runs across backend replicas. Jobs persist progress, bounded
results/errors, deadline, audit correlation, retry lineage, and terminal
expiry. Interrupted running jobs are recovered according to the job service
contract rather than silently treated as successful.

### Accounts

| Method and path | Behavior |
| --- | --- |
| `GET /accounts` | Server-side search, filters, pagination, activity and safe linked-station projection |
| `PATCH /accounts/:accountId/approval` | Barangay approval/revocation |
| `PATCH /accounts/:accountId/lifecycle` | Activate/deactivate with recent login and typed target |
| `POST /accounts/:accountId/sessions/revoke` | Increment session generation after recent login |
| `PATCH /accounts/:accountId/admin-role` | Change viewer/operator/super-admin tier with recent login and typed target |

The domain `admin` role remains separate from `adminRole`. Generation-bound
tokens are checked against persisted account state; account lifecycle and
privilege changes increment the generation. Self-deactivation and removal of
the final super-admin are rejected. Legacy-token limitations and rollout
choices are documented in the deployment repository.

### Earthquake events and public summaries

| Method and path | Behavior |
| --- | --- |
| `GET /earthquake-events` | Filtered/paginated events with recording, catalog, summary-review, job, and community-report evidence |
| `PATCH /earthquake-events/:publicID/summary` | Save custom text and reset review state to Draft |
| `DELETE /earthquake-events/:publicID/summary` | Revert custom text |
| `PATCH /earthquake-events/:publicID/summary/review` | Expected-state Draft/Needs Review/Approved transition |

The backend-generated summary is canonical unless custom text is Approved.
Editing reviewed text invalidates the approval. Optimistic expected-state
checks prevent one operator from overwriting another operator's review. The
temporary `EVENT_SUMMARY_ALLOW_UNAPPROVED_COMPAT` switch exists only for staged
legacy migration.

Public REST/SSE normalization is owned by `eventSummary.service.js`; the public
frontend integration is documented in the frontend repository.

### Community report moderation

| Method and path | Behavior |
| --- | --- |
| `GET /community-reports` | Filtered/paginated moderation queue |
| `GET /community-reports/:commentId/case` | Current case and bounded case-local history |
| `PATCH /community-reports/:commentId/status` | Approve, reject, or return to pending with atomic case update |
| `PATCH /community-reports/:commentId/case` | Open/Investigating/Escalated/Resolved transition with version check |
| `POST /community-reports/:commentId/case/notes` | Append case note with version check |
| `DELETE /community-reports/:commentId` | Permanently delete with separate capability and typed target |

Community issue reasons remain private flagged evidence. They do not
automatically escalate a case. Case-local history is bounded for fast review;
immutable audit records remain the authoritative administrative trail.

### Devices and stations

| Method and path | Behavior |
| --- | --- |
| `GET /devices-stations` | Filtered/paginated station inventory and mapping evidence |
| `GET /devices-stations/ringserver-targets` | Fixed approved remote Ringserver destinations |
| `GET /devices-stations/:deviceId/history` | Cursor-paginated activity and registry transitions |
| `GET /devices-stations/:deviceId/freshness?hours=6|24|72` | Bounded packet-freshness samples |
| `GET /devices-stations/:deviceId/tunnel-observation` | Registry mapping joined to optional host listener evidence |
| `GET /devices-stations/:deviceId/remote-servers` | Read sender Ringserver list through an existing mapping |
| `POST /devices-stations/:deviceId/remote-actions` | Fixed allowlisted add/remove Ringserver operation |
| `POST /devices-stations/:deviceId/tunnel/revoke` | Revoke mapping with typed target confirmation |

Operational history records only transitions observed after deployment.
Freshness samples are separate immutable time buckets. Neither packet age nor a
mapping/listener observation is represented as latency, loss, uptime, or
end-to-end connectivity. See
[`station-operational-history.md`](station-operational-history.md).

### Read-only subsystem workspaces

| Method and path | Evidence boundary |
| --- | --- |
| `GET /ringserver/snapshot` | Bounded Ringserver status/connections/streams; no inferred ownership or token state |
| `GET /seiscomp/snapshot` | Application delivery and fixed FDSNWS evidence; not direct module process health |
| `GET /archive-storage/snapshot` | Read-only mount band and event recording coverage; not archive writer health |
| `GET /inventory-import/workflow` | Safe target/source/template and command plan; apply disabled |
| `GET /deployment-health/snapshot` | Declared services and fixed evidence; no Docker lifecycle authority |
| `GET /configuration-diagnostics/snapshot` | Non-secret effective values and sensitive presence checks only |
| `GET /audit-logs` | Read-only cursor-paginated immutable audit records |

## Persistence and retention

| Model/field | Purpose | Retention decision |
| --- | --- | --- |
| `AuditLog` | Immutable action lifecycle and correlation evidence | `routine_telemetry` and `administrative` absolute expiry classes |
| `AdminIncident` | Deduplicated cross-refresh operational condition | Active indefinitely; resolved expiry only |
| `AdminIncidentEvent` | Immutable incident transitions and notes | Configurable absolute expiry |
| `AdminJob` | Durable background work, progress, results, retries | Terminal jobs expire; active work does not |
| moderation fields on `Comment` | Current case and bounded local case history | Domain record lifecycle plus immutable audit |
| summary-review fields on `Event` | Custom summary state/operator/timestamps | Domain record lifecycle |
| `StationOperationalEvent` | Activity and WSTunnel registry transitions | Configurable TTL, append-only |
| `StationTelemetrySample` | Bucketed Ringserver packet freshness | Configurable TTL and unique station/bucket index |
| account session generation/activity fields | Lifecycle and revocation evidence | Account lifecycle |

MongoDB TTL deletion is asynchronous and does not invoke Mongoose mutation
hooks. Backfills assign explicit `expiresAt` values only after dry-run review.
Operational runbooks live in `earthquake-hub-commons/docs/admin-backend/`.

## Telemetry client behavior

`adminHostTelemetry.client.js` accepts only fixed resource IDs and validates the
normalized adapter envelope. Production configuration requires:

- private network reachability to `https://admin-backend:5100/v1`;
- CA, client certificate, and key from fixed read-only mount paths;
- normal hostname verification for `admin-backend`;
- an independent bearer token;
- a bounded request timeout.

Adapter failure is normalized as unavailable evidence so one source does not
fail an entire Overview response. Telemetry read audit records store resource,
classification, outcome, duration, and correlation—not response bodies.

## Maintenance commands

```bash
npm test -- --runInBand
npm run test:integration:mongo
npm run admin:bootstrap
npm run audit-retention:backfill
npm run audit-retention:export
npm run incident-retention:backfill
npm run summary-review:backfill
```

Bootstrap and backfill commands have dedicated deployment runbooks. Do not run
apply modes against production data without the documented dry run, backup, and
review steps.

## Adding an admin feature

1. Define evidence ownership and the browser contract before adding a page or
   route.
2. Reuse an existing domain service when the data is application-owned.
3. Add a fixed adapter resource only for genuinely host-bound read-only data.
4. Define admin tier, capability switch, reason, CSRF, recent-authentication,
   typed-confirmation, idempotency, and audit requirements.
5. Validate and bound every query, output collection, metadata object, timeout,
   and pagination order.
6. For persisted state, define indexes, concurrency behavior, retention,
   backfill, and rollback before rollout.
7. Add route/service/model tests, authorization rejection tests, and a real
   Mongo integration test when correctness depends on uniqueness or TTL indexes.
8. Update this guide, action policy, frontend guide, feature inventory, env
   reference, and deployment checklist as applicable.

## References

- [OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [MongoDB TTL indexes](https://www.mongodb.com/docs/manual/core/index-ttl/)
- [MongoDB index types](https://www.mongodb.com/docs/manual/core/indexes/index-types/)
- [Node.js TLS](https://nodejs.org/api/tls.html)
- [OWASP SSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html) — rationale for fixed server-owned probes rather than browser-provided URLs.

