# Administrator notifications

The initial administrator-notification contract is intentionally narrow.
It has one optional rule, `overview_source_unavailable`, and one delivery
channel: SMTP email to an opted-in active administrator.

## Evidence boundary

The condition is eligible only when an Overview incident has both:

- source type `overview_source`; and
- `evidence.retrievalStatus` equal to `unavailable`.

This means the backend directly failed to retrieve a particular Overview source.
It does not notify for derived station counts, configured service declarations,
missing container observations, WSTunnel mappings, SeisComP configuration, or
archive event-window checks. Those states do not establish the same condition.

Detected and reopened incident events are candidates. The standard incident
deduplication remains responsible for deciding when these lifecycle events
exist; notification delivery never changes incident persistence or the
availability of an Overview response.

## Ownership and API

- `GET /api/admin/notifications/rule` exposes the non-secret rule state to any
  authenticated admin. `PUT` requires CSRF and a `super_admin`; it has an
  optimistic version and allows only enabled state plus a 5–1,440 minute
  cooldown.
- `GET`/`PUT /api/admin/notifications/preferences` are restricted to the
  caller's active administrator account and hold only that account's email
  opt-in. PUT is CSRF-protected and audited.
- `GET /api/admin/notifications/deliveries` provides the bounded recent
  delivery ledger to authenticated admins. It never returns SMTP configuration
  or message contents.

The default rule is disabled and every account starts opted out. Existing
accounts require no migration. A super administrator must enable the rule, and
each recipient must enable their personal preference before SMTP is contacted.

## Delivery and audit

Delivery records track pending, sent, failed, and cooldown-suppressed outcomes.
Their event-specific unique key prevents duplicate sends for a lifecycle event;
the cooldown also suppresses a newly detected/reopened event for the same
incident and recipient. Rule changes and personal preference changes are
recorded through the immutable admin audit lifecycle. SMTP errors are retained
in the delivery ledger and are not returned through the Overview snapshot.

The application reuses the existing `email.service` SMTP transport. It has no
new provider credentials and does not use existing public web-push subscriptions
because those subscriptions are not safely attributable to administrator
accounts. Local tests mock `sendMail`; they do not send email.

## Rollout and rollback

Deploy the backend schema/API with the frontend or first. Leaving the rule
disabled is a safe rollout state. To stop sends, disable the rule; no account,
incident, delivery history, SMTP setting, or session must be deleted. Rolling
back older application code leaves optional MongoDB fields and notification
collections inert.
