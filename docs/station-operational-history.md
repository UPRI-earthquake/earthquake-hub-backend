# Station operational history contract

The hub backend owns an append-only, bounded history of station state changes
that it can observe directly. The admin frontend is a read-only consumer of
this evidence.

## Recorded events

| Event | Source | Evidence retained |
| --- | --- | --- |
| `activity_changed` | `ringserver_stream_status` | Previous/next backend activity, stream ID, latest packet timestamp, packet age at observation, and the inactivity threshold |
| `tunnel_enrolled` | `tunnel_registry_action` | Mapping state change, allocated remote port, actor, and audit correlation ID |
| `tunnel_revoked` | `tunnel_registry_action` | Mapping state change, actor, and audit correlation ID |

Only transitions are written. Repeated Ringserver observations with the same
activity state do not create records. History begins when the feature is
deployed; existing activity state and registry mappings are not reconstructed
or presented as historical transitions.

## Sampled packet freshness

Packet freshness is retained separately from transition history so periodic
samples do not hide operational events. Ringserver emits its stream inventory
every three seconds; the backend groups rows by station and keeps the latest
packet timestamp and row count for that observation. MongoDB stores at most one
sample per station and configured time bucket.

```http
GET /admin/devices-stations/:deviceId/freshness?hours=24
```

The browser can request only fixed 6, 24, or 72-hour windows. Responses are
bounded to 1,000 samples, ordered oldest to newest, and identify truncation.
Each sample includes observation time, latest packet time, packet age,
inactivity threshold, derived active/inactive state, Ringserver stream-row
count, and the configured sampling interval.

## Evidence boundaries

- Packet age is freshness at the time of the Ringserver observation. It is not
  network latency, packet loss, a gap count, uptime, or per-channel health.
- A missing sample is not interpreted as downtime. It can also mean the backend,
  Ringserver SSE source, database, or station stream row was unavailable.
- WSTunnel events prove that a registry action succeeded. A mapping does not
  prove that the tunnel listener is currently connected or reachable.
- Archive availability and FDSNWS verification remain separate event-level or
  host/service evidence and are not inferred from station activity.
- Key material, tunnel public keys, host paths, commands, and raw telemetry
  bodies are never stored in station history.

## Read contract

Authorized administrators can request:

```http
GET /admin/devices-stations/:deviceId/history?limit=25&cursor=...
```

`eventType` can optionally filter to one of the three fixed event types. Results
are ordered by `observedAt` and `_id` descending and use an opaque cursor. The
browser cannot select a source, collection, command, host, or arbitrary field.

## Retention and failure behavior

`ADMIN_STATION_HISTORY_RETENTION_DAYS` defaults to 365 and must remain between 1
and 3650 days. Every record receives an absolute `expiresAt` value and MongoDB
removes it through a TTL index. Records reject document and query mutations;
corrections require a later event.

Freshness samples default to a 900-second interval and 90-day retention through
`ADMIN_STATION_TELEMETRY_SAMPLE_INTERVAL_SECONDS` and
`ADMIN_STATION_TELEMETRY_RETENTION_DAYS`. The interval is bounded from 60 to
86,400 seconds and retention from 1 to 3,650 days. A unique station/bucket index
deduplicates concurrent or restarted backend instances; a short in-process
guard prevents repeated insert attempts on every three-second SSE update.

The underlying device or tunnel operation remains authoritative if a history
write fails after that operation succeeds. The backend logs the history failure
without claiming that the external operation failed. Audit logs remain the
authoritative administrative action trail for tunnel changes.
