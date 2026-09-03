# Fluxa control-plane consistency (v0.8.0)

Fluxa intentionally separates the **data plane** from the **control plane**.

## Data plane

VLESS/Trojan WebSocket traffic stays on ordinary stateless Workers. Client proxy traffic never traverses `FluxaCoordinator`.

Workers KV is used as an edge-readable cache for configuration and the node catalog. KV is eventually consistent, so edge locations can briefly observe an older value after a control-plane change.

## Control plane

One SQLite-backed `FluxaCoordinator` Durable Object represents the single logical Fluxa installation control plane. It handles only low-frequency operations:

- authoritative configuration update and rollback;
- bounded rollback history;
- bounded administrator audit history;
- global catalog-refresh coordination and final catalog commit.

This avoids multiple Worker PoPs concurrently writing the same KV keys.

## Optimistic config writes

`GET /api/config` returns an `ETag` such as:

```text
"fluxa-config-7"
```

A config PUT or rollback must return that value in `If-Match`.

If another administrator tab already changed config, Fluxa returns `412 Precondition Failed`. The caller must reload config and deliberately retry.

## Catalog refresh vs config changes

Catalog source discovery performs slow network I/O outside the mutation queue. Immediately before saving the refreshed catalog, the coordinator re-enters the mutation queue and compares the active config fingerprint again.

If config changed during discovery, the old refresh is discarded with a stale-refresh conflict and cannot overwrite a catalog generated for the new config.

This is an optimistic-locking pattern: do slow I/O concurrently, then verify state has not changed before commit.

## Upgrade from v0.7 and earlier

On first control-plane access, the Durable Object initializes from the existing KV config and imports legacy KV rollback/audit records. Future official control-plane writes use Durable Object storage for strong ordering and use KV as the global edge-readable cache.
