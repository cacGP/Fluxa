# Security Policy

Fluxa separates `ADMIN_TOKEN`, `SUB_TOKEN`, `CLIENT_UUID`, and `TROJAN_PASSWORD`. Never reuse them. Store them as Cloudflare Workers secrets, not plaintext values committed to GitHub.

If you configure `UPSTREAM_PROXY`, store the entire URL (including credentials) as a Worker secret. Fluxa does not ship an author-controlled relay.

Default target ports are only 80 and 443. Localhost, private/link-local/multicast and common special-use destinations are blocked before direct dialing. Worker self-loop targets are blocked. Upstream relay destinations are DNS-checked for non-public A/AAAA results before HTTP CONNECT is sent.

Third-party address sources are opt-in. Source URLs must be public HTTPS endpoints. Fluxa follows redirects manually and revalidates every redirect target instead of blindly following redirects. Literal IPv4 addresses from those sources must belong to Cloudflare's official IPv4 CIDRs by default. Source failures and invalid data reduce source reputation and can cause dependent nodes to disappear from subscriptions.

Administrator audit records are deliberately minimal. They must never contain tokens, UUIDs, relay credentials, client traffic, requested destination hosts, or user IP addresses.

Do not publish live subscription URLs, relay credentials, UUIDs or administrator tokens in issues or screenshots. Rotate a credential immediately if it leaks.

Before publishing a release, run:

```bash
npm run release-check
```

This runs TypeScript checks, regression tests and a basic hard-coded production-secret scan. It is a guardrail, not a substitute for review.

For a vulnerability report, use a private GitHub Security Advisory after the repository is published.

## Configuration rollback

In the official v0.8 deployment, `FluxaCoordinator` stores the authoritative configuration revision, at most eight validated configuration snapshots, and the bounded administrator audit log in SQLite-backed Durable Object storage. Pre-v0.8 KV history/audit records are imported once during control-state bootstrap. Workers KV remains an edge-readable configuration/catalog cache. Snapshots contain `FluxaConfig` only; `ADMIN_TOKEN`, `SUB_TOKEN`, `CLIENT_UUID`, `TROJAN_PASSWORD`, and `UPSTREAM_PROXY` remain Worker secrets/environment values and are never copied into history. Rollback endpoints require the administrator Bearer token and, on the official control-plane path, the current configuration `ETag` in `If-Match`.

## Session reliability

Inbound WebSocket messages are serialized per connection before handshake parsing and outbound writes. TCP socket opening and HTTP CONNECT negotiation are time-bounded to reduce stuck sessions and resource retention.


## v0.5 upstream DNS pinning

When an operator configures `UPSTREAM_PROXY`, Fluxa does not send an arbitrary client-supplied hostname to that relay. The Worker first resolves A/AAAA, rejects the target if any returned address is private/special-use, selects a validated public address, and sends the CONNECT request to that pinned address. This prevents the relay from performing an independent DNS lookup that could resolve differently or be changed by DNS rebinding.

In selective `cloudflare` mode, DNS lookup failure may still allow Cloudflare's native direct `connect()` attempt, whose runtime already rejects localhost/private/disallowed targets. Fluxa will not use the external upstream fallback without a validated public resolution.

## Administrator request hardening

Configuration PUT bodies are limited to 64 KiB and rollback bodies to 4 KiB, read as bounded streams, and require `application/json`. Proxy protocol paths are validated against reserved management/subscription routes. The admin UI uses a per-response CSP nonce rather than `script-src 'unsafe-inline'`.

## v0.6 public-address and session hardening

Fluxa v0.6+ parses IPv6 literals numerically before classifying public/private scope. This prevents alternate textual spellings of loopback, IPv4-mapped IPv6, ULA, link-local, multicast, documentation and benchmarking ranges from bypassing simple string-prefix checks. IPv4 special-purpose handling is also narrowed so public `192.0.x.x` addresses are not rejected merely because they share the first two octets with a reserved block.

Proxy WebSocket sessions require the protocol handshake to finish within 15 seconds and reject individual inbound frames larger than 4 MiB. These limits are intended to bound idle-handshake and oversized-frame resource use without changing the normal TCP tunnel semantics.

The official Wrangler deployment binds one SQLite-backed `FluxaCoordinator` Durable Object. v0.7 introduced it for shared catalog-refresh coordination; v0.8 promotes it to the authoritative low-frequency control plane for configuration mutations, history, audit events, and guarded catalog commits. Ordinary proxy traffic remains stateless and does not traverse the Durable Object. Workers KV is still eventually consistent and is used as the edge-readable cache, so operators should allow propagation time after configuration changes.


## v0.7 multi-host isolation

The request hostname (`workers.dev` or a custom domain) is not stored in the shared node catalog. It is inserted only when a subscription is generated for that request. Any legacy catalog entry marked with the old `worker` origin is excluded from subscriptions immediately and purged on the next catalog refresh. This prevents one hostname from being unintentionally advertised through another hostname sharing the same Worker/KV catalog.


## v0.8 optimistic control-plane concurrency

Administrator config writes and rollbacks use a monotonic configuration revision exposed as an HTTP `ETag`. The official admin UI first GETs `/api/config`, then sends the returned value in `If-Match` for PUT/rollback. Missing preconditions are rejected and stale revisions receive `412 Precondition Failed`, preventing an old browser tab from silently replacing a newer configuration.

Catalog discovery may perform slow external I/O outside the mutation queue, but the coordinator rechecks the active configuration immediately before the catalog KV commit. A refresh built under an obsolete configuration is rejected instead of overwriting the newer catalog. VLESS/Trojan data-plane traffic does not traverse this control plane.
