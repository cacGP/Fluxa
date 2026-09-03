# Fluxa configuration recovery (v0.8.0)

In the official v0.8 deployment, `FluxaCoordinator` is authoritative for configuration revision/history. Before every accepted administrator configuration update and before every rollback, Fluxa records a validated `FluxaConfig` snapshot in SQLite-backed Durable Object storage. History is bounded to eight revisions. Pre-v0.8 KV history is imported once when the Durable Object control state is first initialized.

Workers KV still holds the edge-readable active configuration cache used by stateless requests; it is not the v0.8 authority for revision ordering.

## What is included

- title, protocol toggles and paths
- target-port allowlist
- edge addresses and source URLs
- quality thresholds and limits

## What is never included

- `ADMIN_TOKEN`
- `SUB_TOKEN`
- `CLIENT_UUID`
- `TROJAN_PASSWORD`
- `UPSTREAM_PROXY` credentials

Those values are Worker secrets/environment configuration, not part of `FluxaConfig`.

## API

- `GET /api/config` — returns the authoritative config plus an `ETag` such as `"fluxa-config-7"` when `FLUXA_COORDINATOR` is bound.
- `GET /api/config/history` — lists the newest eight snapshots.
- `POST /api/config/rollback` with `{ "id": "REVISION_ID" }` — validates and restores a selected snapshot, increments the control revision, refreshes the node catalog asynchronously, and records an audit event.

On the official v0.8 control plane, PUT `/api/config` and POST `/api/config/rollback` require `Authorization: Bearer <ADMIN_TOKEN>` plus the current config ETag in `If-Match`. A missing precondition is rejected; a stale ETag receives `412 Precondition Failed`. The admin UI handles this automatically. Custom automation must first GET `/api/config` and preserve its ETag.

## Operational guidance

Use rollback for configuration mistakes, not for Worker-code rollback. Code releases should still be versioned and released through Git/GitHub. After a successful change or rollback, allow Workers KV propagation time before assuming every PoP has observed the new edge-cache value.
