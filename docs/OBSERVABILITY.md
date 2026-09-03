# Fluxa observability (v0.8.0)

Fluxa intentionally keeps observability small and privacy-conscious.

## Public endpoints

### `/health`

Returns release version, enabled protocols, KV binding state, and a compact catalog summary.

### `/api/capabilities`

Returns supported protocols, subscription formats, aliases, compatibility notes, and reliability flags including v0.8 control-plane consistency/optimistic config writes/stale-catalog commit guarding. It contains no secrets.

## Administrator endpoints

All require `Authorization: Bearer <ADMIN_TOKEN>`.

### `/api/diagnostics`

Performs read-only invariant checks such as:

- KV binding status
- Durable Object control-plane binding status
- at least one protocol enabled
- distinct VLESS/Trojan paths
- credential separation
- catalog existence/freshness/config match
- eligible-node count
- severely failing source count

Secret values are never included.

### `/api/config`, `/api/config/history`, `/api/config/rollback`

On the official v0.8 deployment, `GET /api/config` reads the authoritative Durable Object control state and returns an `ETag` for its monotonic revision. Mutations require that value in `If-Match`. History returns up to eight validated non-secret snapshots stored in Durable Object control state; rollback restores one selected revision and advances the revision. Workers KV remains the edge-readable config cache.

### `/api/audit`

Returns a bounded newest-first administrator event log from Durable Object control state in the official deployment. Pre-v0.8 KV audit data is imported once during bootstrap. Current events include:

- `config.update`
- `config.rollback`
- `catalog.refresh`
- `catalog.refresh.failed`

Fluxa deliberately does not log client traffic, destination hosts, passwords, subscription tokens, client UUIDs, administrator tokens, or user IP addresses.

## Subscription delivery metadata

Subscription responses include:

- `ETag`
- `X-Fluxa-Version`
- `X-Fluxa-Format`
- `Profile-Update-Interval: 24`
- private short-lived caching with revalidation

`HEAD` and `If-None-Match` are supported to reduce unnecessary transfer without making subscriptions public-cacheable.

## Post-deployment smoke check

`npm run smoke` performs read-only HTTP checks when `FLUXA_URL`, `FLUXA_ADMIN_TOKEN`, and `FLUXA_SUB_TOKEN` are supplied as environment variables. v0.8 also verifies that the official deployment reports control-plane capability flags and that `GET /api/config` exposes a Fluxa config ETag. It does not mutate configuration or run proxy traffic.
