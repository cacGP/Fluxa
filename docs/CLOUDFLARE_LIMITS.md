# Cloudflare limits considered by Fluxa v0.8.0

Checked against Cloudflare documentation on 2026-09-03.

- Workers Free: 50 external subrequests per invocation and 6 simultaneous outgoing connections waiting for response headers per request.
- Workers Free: 100,000 requests/day.
- Workers KV Free: 1,000 writes/day; the same KV key can be written at most once per second.
- Workers KV is eventually consistent. A changed value may remain stale at other Cloudflare locations for roughly 60 seconds or longer depending on cache state.
- Cron Triggers run on UTC.
- Raw Workers TCP sockets cannot connect to Cloudflare-owned IP ranges.

Design consequences:

1. `sourceUrls` is capped at 16. Each source may use up to three HTTP requests (initial request + two validated redirects), so the worst-case external refresh budget is `16 × 3 + 1 = 49`, staying within the Workers Free 50-subrequest ceiling.
2. Source fetches run with a concurrency limit of 4, below the per-request simultaneous outgoing-connection limit of 6.
3. Concurrent stale-catalog refreshes are first coalesced inside each Worker isolate and globally routed through one SQLite-backed `FluxaCoordinator` Durable Object. v0.8 also serializes low-frequency config/history/audit mutations there instead of letting multiple PoPs independently write the same control-plane KV keys.
4. A failed background refresh receives a short retry cooldown instead of being restarted by every stale-catalog request.
5. The catalog is persisted as one KV object instead of one key per node.
6. The default two-hour cron is only 12 catalog writes/day, far below the Free KV write allowance and same-key write-rate limit.
7. Fluxa uses a configuration fingerprint so a catalog generated under older configuration is not treated as fresh.
8. Fluxa does not claim immediate global configuration propagation because KV is eventually consistent. In v0.8, Durable Object state is authoritative for administrator revision ordering while KV remains the edge-readable cache.
9. Fluxa does not attempt Worker-side raw TCP latency tests against Cloudflare candidate IPs.
10. Optional upstream routing is provided for destinations affected by Cloudflare's raw TCP restriction.
11. Durable Objects are used only for the low-frequency control plane (config/history/audit/catalog commit coordination), not for ordinary proxy traffic; SQLite-backed Durable Objects are available on Workers Free.
12. Config PUT/rollback use revision ETags and `If-Match`; catalog refresh rechecks the current revision/fingerprint before KV commit so slow external discovery cannot commit stale results after a config edit.

References:

- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/
- https://developers.cloudflare.com/kv/platform/limits/
- https://developers.cloudflare.com/kv/concepts/how-kv-works/
- https://developers.cloudflare.com/workers/configuration/cron-triggers/
- https://developers.cloudflare.com/durable-objects/
- https://developers.cloudflare.com/durable-objects/platform/limits/
