# Fluxa architecture

Fluxa is split into auditable modules instead of a single large Worker file.

- `src/index.ts` — HTTP router, admin/subscription endpoints, config recovery endpoints and scheduled catalog refresh.
- `src/coordinator.ts` — SQLite-backed Durable Object that globally coordinates the shared catalog refresh/write path.
- `src/coordinator-client.ts` — Worker-side client for the private Durable Object binding.
- `src/proxy/session.ts` — WebSocket tunnel lifecycle and target policy.
- `src/protocols/` — VLESS and Trojan wire parsing.
- `src/upstream-config.ts` — runtime-independent HTTP CONNECT relay configuration parser.
- `src/upstream.ts` — direct/upstream outbound routing, bounded connect/handshake timeouts and Cloudflare IPv4/IPv6 DoH detection.
- `src/subscriptions.ts` — multi-client configuration generation and format detection.
- `src/subscription-response.ts` — ETag, HEAD and private subscription response metadata.
- `src/nodes.ts` — source parsing, validated redirects, Cloudflare IP discovery and CIDR utilities.
- `src/catalog.ts` — source reputation, FluxScore, catalog history and automatic retirement.
- `src/config.ts` — schema validation, v1→v2 migration and KV persistence.
- `src/config-history.ts` — bounded non-secret configuration snapshots and rollback lookup.
- `src/async-utils.ts` — serial task execution and bounded async timeouts.
- `src/security.ts` — credential comparison, hostname/path checks and target filtering.
- `src/audit.ts` — bounded privacy-conscious administrator event history.
- `src/diagnostics.ts` — read-only deployment invariant checks.
- `src/admin-ui.ts` — lightweight dependency-free management interface.

## Data flow

1. Configuration is loaded from KV (or safe defaults).
2. The catalog refresh obtains Cloudflare official CIDRs and the operator's opt-in HTTPS sources.
3. Third-party redirects are followed manually and every redirect target is revalidated.
4. Source responses are parsed and filtered. Third-party IPv4 addresses are Cloudflare-CIDR checked by default.
5. Source reputation is updated from historical and current evidence.
6. Candidate evidence is merged, scored and compared with the previous catalog.
7. Repeatedly missing candidates are retired.
8. The shared catalog never persists the request-specific Worker/custom-domain hostname.
9. Subscription generators inject the current request hostname, then add only shared candidates meeting the configured score threshold.
10. The subscription delivery layer adds format metadata, conditional GET and HEAD support without making tokenized subscriptions public-cacheable.

## Scheduled refresh

The default Wrangler configuration runs one cron every two hours. Catalog refresh requests are routed through the private `FLUXA_COORDINATOR` Durable Object binding. One catalog object is written to one KV key per coordinated refresh. This deliberately avoids both a per-node KV write design and cross-PoP duplicate refreshes. Ordinary proxy traffic does not traverse the Durable Object.

## Outbound routing

The default path is direct `connect()` to a public target. Cloudflare's platform blocks some destinations/routes that cannot be safely handled by a direct Worker TCP socket, so Fluxa supports an optional operator-owned HTTP CONNECT relay. In selective mode the Worker uses official Cloudflare IPv4/IPv6 CIDRs and Cloudflare DoH A/AAAA records to decide when to use that relay, with direct failure fallback. Direct socket open and CONNECT handshakes are time-bounded.

## Compatibility policy

Fluxa separates three levels of confidence:

1. **Generated structurally** — automated tests verify the output structure.
2. **Documented compatibility** — current client documentation describes the relevant protocol/transport syntax.
3. **Production verified** — a real client/version imported the subscription and established a real connection through a deployed Worker.

A release must not silently promote level 1 into level 3.

## Session ordering and recovery

WebSocket ingress is serialized per session before protocol parsing and outbound writes. This prevents fragmented or rapidly delivered frames from racing the shared handshake state. Configuration changes snapshot the prior validated configuration into a bounded KV history before overwrite; rollback snapshots the current state before restoring an older revision. Worker secrets are not part of `FluxaConfig` and are never stored in configuration history.
