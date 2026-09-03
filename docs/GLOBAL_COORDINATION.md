# Fluxa global control-plane coordination (v0.8.0)

Fluxa's proxy data plane stays stateless and globally distributed. `FluxaCoordinator` exists only for the small set of low-frequency operations that require global ordering.

## Evolution

- **v0.7:** Durable Object coordinated shared node-catalog refreshes across Worker PoPs.
- **v0.8:** the same stable object becomes the authoritative control plane for config mutation revisioning, rollback history, administrator audit events, and guarded catalog commits.

## Why a Durable Object is used

Workers can execute the same code in different isolates and PoPs. An in-memory single-flight map prevents duplicate work only inside one isolate. Workers KV is eventually consistent; concurrent same-key writes are not a substitute for ordered control-plane state.

The official deployment binds one SQLite-backed Durable Object named `FluxaCoordinator`. Internal control requests are routed to the stable object name `catalog`, giving Fluxa one coordination atom without putting proxy traffic through it.

## What the coordinator does

1. Bootstraps control state once from the existing validated KV config plus legacy pre-v0.8 history/audit data.
2. Stores the authoritative config revision, active validated config, up to eight rollback snapshots, and bounded administrator audit history in Durable Object storage.
3. Serializes config update/rollback mutations.
4. Enforces optimistic revisions supplied by the Worker from HTTP `If-Match`.
5. Coalesces catalog refresh work for a configuration fingerprint.
6. Allows slow source discovery outside the mutation queue, then rechecks the active config immediately before the catalog KV commit. If config changed, the stale refresh is discarded.
7. Writes the validated active config to Workers KV as the stateless edge-readable cache.

## What it does not do

- It does not receive VLESS/Trojan client traffic.
- It does not terminate proxy WebSockets.
- It does not store subscription/admin/protocol secrets; those remain Worker secrets.
- It does not turn Fluxa into a single-region proxy.

## KV's role in v0.8

Workers KV remains useful for globally distributed reads: active config cache, node catalog and source-history data. It is not the authoritative revision sequencer for v0.8 administrator control state. Because KV is eventually consistent, data-plane PoPs may observe an older cached configuration for a propagation window after an accepted admin change.

## Compatibility fallback

If Fluxa is copied into a nonstandard deployment without the Durable Object binding, legacy KV-backed config/history/audit and isolate-local catalog-refresh behavior remain as compatibility fallback. Diagnostics marks the missing coordinator as a warning. The checked-in Wrangler configuration is the supported path for public GitHub releases.

## Host isolation

The shared catalog contains only shared candidates. Request-specific hostnames such as `example.workers.dev` or `proxy.example.com` are added at subscription-generation time. This prevents one custom domain from becoming a persisted candidate that later appears in a subscription requested through another domain.

For the config-revision protocol and stale-refresh commit guard, see `CONTROL_PLANE_CONSISTENCY.md`.
