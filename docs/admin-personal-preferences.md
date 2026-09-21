# Personal administrator preferences

`GET /api/admin/preferences` and `PUT /api/admin/preferences` act only on the
authenticated administrator's account ID. There is no target-account parameter;
query parameters and unknown payload fields are rejected. All existing admin
tiers may personalize their own layout. This does not grant operational
capabilities. PUT uses the existing cookie/header/signed-claim CSRF protection
and `admin.preferences.update` audit lifecycle.

Account `adminPreferences` stores `{ version, dashboardLayout }`. It is excluded
from ordinary account queries by default. Missing preferences on existing
accounts read as version 0 and a null/default layout; no bulk migration is needed.
The explicit endpoint selects only the preference result for the browser.

PUT requires the last retrieved version. The update matches that version and the
same active administrator account, then increments it atomically. A stale version
returns 409 and the client requires reload. Dashboard layout contains exactly
the six supported widget IDs and integer positions/sizes on the 12-column grid.
Widget widths/heights and total vertical extent are bounded. Null resets the
saved dashboard to defaults. No server configuration, role, notification
recipient, credential or arbitrary component definition is accepted.

Overview provides explicit Save layout. Drag/reorder/resize/reset stays local
until saved. A failed preferences read leaves the default/local layout usable
and disables saving; it must not overwrite an unseen saved version. Save failures
retain the visible layout for retry. Profile & preferences, reached through the
account menu, shows identity/tier and can reset the saved dashboard. System
configuration remains at Settings.

Deployment: release backend before or with frontend. Old accounts need no data
rewrite. Rollback can leave the inert embedded field in MongoDB; older code does
not use it. Do not delete accounts or change role/session fields to reset layout.
Administrator notifications are a separate, intentionally narrow contract in
[`admin-notifications.md`](admin-notifications.md). The personal email opt-in
does not alter dashboard layout data or system-wide rule configuration.
