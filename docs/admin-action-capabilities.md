# Admin action capability policy

The hub backend is authoritative for Admin Console mutations. Successful admin
authentication and profile responses include a versioned `capabilities`
document. The frontend uses that document to explain or disable unavailable
controls, but frontend state is not an authorization boundary.

Every supported mutation route enforces all of the following on the server:

1. authenticated account with the `admin` role;
2. matching admin CSRF cookie, token claim, and request header;
3. enabled action capability;
4. required administrator reason;
5. immutable started/succeeded/failed audit lifecycle.

Account deactivation/activation and admin privilege changes additionally require
recent authentication and a `confirmation` value that exactly matches the
target account ID. Community-report deletion and WSTunnel revocation also
require exact target confirmation. Rejected capability, recent-authentication,
and typed-confirmation checks are audited without storing the submitted
confirmation value.

Admin privilege tiers are independent of domain roles:

- `viewer`: authenticated read-only access;
- `operator`: supported operational workflows, including incident management;
- `super_admin`: operator workflows plus account lifecycle, session revocation,
  and admin privilege management.

Existing admin records without `adminRole` are interpreted as `super_admin`
during migration. Newly issued account tokens include a session generation and
are checked against persisted account state on each request. Legacy refresh
tokens are upgraded to the current generation only after the account remains
active and authorized; already issued legacy access tokens retain only their
existing configured lifetime. A production rollout must therefore rotate the
affected signing keys, with the corresponding web/device re-authentication
procedure, before claiming immediate revocation of tokens issued by older
releases. Generation-bound tokens issued by this release are invalidated
immediately when the persisted generation changes.

## Supported mutation switches

All currently supported action families default to enabled when the variable is
omitted. Operators can set a variable to `false`, `0`, `no`, or `off` and
restart the backend to disable the corresponding API mutation and frontend
control:

| Environment variable | Action family |
| --- | --- |
| `ADMIN_ACCOUNT_APPROVAL_ENABLED` | Barangay account approval and revocation |
| `ADMIN_ACCOUNT_LIFECYCLE_ENABLED` | Account activation and deactivation |
| `ADMIN_ACCOUNT_SESSION_REVOCATION_ENABLED` | Account session revocation |
| `ADMIN_ACCOUNT_ROLE_MANAGEMENT_ENABLED` | Admin privilege tier changes |
| `ADMIN_INCIDENT_MANAGEMENT_ENABLED` | Operational incident lifecycle and notes |
| `ADMIN_REPORT_MODERATION_ENABLED` | Community-report status decisions |
| `ADMIN_REPORT_DELETION_ENABLED` | Permanent community-report deletion |
| `ADMIN_EVENT_SUMMARY_ENABLED` | Custom event summary update and revert |
| `ADMIN_EVENT_SUMMARY_REVIEW_ENABLED` | Draft, Needs Review, and Approved summary transitions |
| `ADMIN_EVENT_ENRICHMENT_ENABLED` | Batch external-catalog enrichment |
| `ADMIN_EVENT_RECORDING_REFRESH_ENABLED` | Batch recording-availability refresh |
| `ADMIN_DEVICE_REMOTE_ACTIONS_ENABLED` | Sender Ringserver add/remove |
| `ADMIN_TUNNEL_REVOCATION_ENABLED` | WSTunnel mapping revocation |

These switches are operational circuit breakers, not substitutes for role
authorization, CSRF protection, target validation, or audit logging.

Approved is the default public publication boundary for custom event summaries.
The public event API returns the backend-generated summary while a custom
summary is Draft or Needs Review, and returns the custom text only after it is
Approved. `EVENT_SUMMARY_ALLOW_UNAPPROVED_COMPAT=true` is a temporary rollout
escape hatch for older clients; it is not an authorization control and should
be returned to `false` after legacy records are reviewed.

`ADMIN_RECENT_AUTH_MAX_AGE_SECONDS` controls the maximum login age for
high-risk account actions and defaults to 900 seconds.

## Intentionally unavailable actions

The capability response explicitly marks these actions unavailable:

- inventory apply;
- SeisComP service reload/restart;
- Docker Compose or deployment lifecycle control.

They remain host-only until a separately reviewed executor design includes
least-privilege credentials, bounded commands, concurrency controls, progress
reporting, rollback behavior, and complete audit coverage.
