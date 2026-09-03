# Fluxa

**Fluxa** is a security-first edge proxy, node-quality catalog, source-reputation engine, multi-client subscription generator and observability layer for Cloudflare Workers.

It is an independent implementation designed for maintainability and auditability rather than a fork of CFBox.

> Current release: **v0.8.0** (2026-09-03). This release makes the SQLite-backed `FluxaCoordinator` the authoritative low-frequency control plane for configuration mutations, rollback history, administrator audit events, and catalog commits. It adds revision/ETag optimistic concurrency and stale-catalog commit protection while keeping ordinary VLESS/Trojan traffic stateless.

## What works in v0.8.0

### Proxy core

- VLESS over WebSocket for TCP CONNECT
- Trojan over WebSocket for TCP CONNECT
- TLS-only generated client profiles
- Direct outbound TCP for public destinations on the configured port allowlist
- Optional operator-supplied HTTP/HTTPS CONNECT upstream relay
- Selective upstream routing for Cloudflare-hosted IPv4/IPv6 destinations using official Cloudflare CIDRs and DoH A/AAAA checks
- Direct-route failure fallback to the configured relay when selective upstream mode is enabled

### Security model

- Separate `ADMIN_TOKEN`, `SUB_TOKEN`, `CLIENT_UUID`, and `TROJAN_PASSWORD`
- Required secrets are never included in administrator diagnostics or audit history
- Strict configuration schema and bounded source counts/timeouts (maximum 16 external sources)
- Default target-port allowlist: 80 and 443
- Localhost, private, link-local, multicast and common special-use targets are blocked
- Worker self-loop targets are blocked
- Third-party source URLs must be public HTTPS addresses
- Every third-party source redirect is manually revalidated; automatic blind redirects are not used
- Third-party IPv4 candidates can be required to belong to Cloudflare official CIDRs (enabled by default)
- Management API requires Bearer authentication; subscription credentials cannot modify configuration
- VLESS UUID and Trojan password-hash checks use constant-time comparison
- Proxy protocol paths cannot collide with management, health or subscription routes
- Administrator JSON bodies are size-bounded and must use `application/json`
- Admin script/style execution is restricted by a per-response CSP nonce
- Upstream HTTP CONNECT destinations are resolved and pinned to a validated public IP before the relay sees them

### Node intelligence

- Shared catalog origins for manually trusted addresses, Cloudflare official IPv4 samples and opt-in third-party sources; the current Worker/custom-domain hostname is injected only at subscription generation time and is never persisted into the shared catalog
- `FluxScore` (0-100) for every candidate
- Source reputation score and A/B/C/D/F grade
- Source attempt/success/failure/fetch-duration/parsed/accepted history
- Stable Cloudflare official-CIDR sampling
- Multi-source recurrence increases confidence
- Missing candidates accumulate misses and can be automatically retired
- Candidate states: `recommended`, `healthy`, `probation`, `quarantined`, `retired`
- Only nodes meeting configured quality policy are emitted into subscriptions
- Scheduled quality-catalog refresh every two hours when KV is bound
- External source refresh uses four-way concurrency to respect Workers connection limits

### Reliability and recovery

- Inbound WebSocket frames are processed through a serial async queue so handshake fragments cannot race each other.
- Direct TCP open and upstream CONNECT handshake operations have bounded 10-second timeouts and best-effort cleanup.
- Cloudflare destination detection covers official IPv4 and IPv6 CIDRs and DoH A/AAAA answers.
- Up to 8 validated configuration snapshots are retained in Durable Object control state before updates/rollbacks in the official deployment; legacy KV history is imported once during v0.8 bootstrap.
- Authenticated configuration history and rollback APIs are available from the admin UI, with monotonic configuration revisions and `ETag` / `If-Match` protection against stale-tab overwrites.
- `npm run smoke` provides a read-only post-deployment HTTP verification pass without placing credentials in command-line arguments.
- Selective upstream fallback is only permitted after safe public DNS resolution; a relay never receives an unchecked destination hostname.
- Concurrent stale-catalog requests are coalesced locally and, in the official Wrangler deployment, globally through the SQLite-backed control-plane Durable Object. A refresh built from an older configuration is rejected before its KV catalog commit.
- Failed background refreshes observe a short retry cooldown to reduce source/KV storms during outages. If a required synchronous refresh fails, subscriptions degrade to the current Worker/custom-domain hostname instead of failing closed with a 500 response.
- Catalogs carry a configuration fingerprint; a catalog built from older configuration is rebuilt before subscription use. Legacy pre-v0.7 persisted Worker hostnames are excluded immediately from subscriptions and purged on refresh.
- Proxy handshakes must complete within 15 seconds and inbound WebSocket frames are capped at 4 MiB.
- The last validated Cloudflare CIDR list can be reused when the official IP API is temporarily unavailable.

### Client/subscription matrix

| Format | Fluxa protocols emitted | Notes |
| --- | --- | --- |
| Raw base64 URI | VLESS + Trojan | Intended for URI-subscription clients such as v2rayN/v2rayNG/Shadowrocket |
| Plain URI | VLESS + Trojan | Human-readable/debug/import bundle |
| Clash/Mihomo YAML | VLESS + Trojan | WS + TLS configuration; no `DIRECT` first-entry surprise |
| sing-box JSON | VLESS + Trojan | Selector outbound + final route |
| Loon config | VLESS + Trojan | Uses documented VLESS WSS and Trojan WS syntax |
| Surge config | Trojan only | Fluxa deliberately does not fabricate undocumented VLESS support |

Aliases:

- `format=mihomo` -> `clash`
- `format=v2rayn` -> `raw`
- `format=v2rayng` -> `raw`
- `format=shadowrocket` -> `raw`
- `format=auto` -> best effort based on `User-Agent`

Subscription responses support `HEAD`, ETag/`If-None-Match`, a short private cache window, `X-Fluxa-Version`, and `X-Fluxa-Format` headers.

### Management and observability

- Lightweight browser admin panel
- Node summary, FluxScore table and source reputation table
- Manual node-catalog refresh
- `/api/diagnostics` read-only administrator checks
- `/api/audit` privacy-conscious administrator event history
- Audit history records configuration changes and manual refresh outcomes, but not client traffic, passwords, tokens or IP addresses
- `/api/capabilities` public machine-readable capability description
- SQLite-backed Durable Object authority for configuration revision/history/audit in the official deployment, with Workers KV retained as the edge-readable configuration/catalog cache

## FluxScore is not fake latency

Cloudflare Workers cannot honestly infer the user's last-mile latency to an Anycast edge address from server-side evidence alone. Fluxa therefore does **not** label candidates as “20 ms” or “300 Mbps” merely because an address exists.

`FluxScore` measures evidence Fluxa can actually observe on the Worker side: source history, origin trust, official-CIDR membership, recurrence and freshness/miss history. Client-side latency measurement is intentionally a separate future component.

See `docs/QUALITY_ENGINE.md`.

## Optional upstream relay

Some destinations require an operator-controlled upstream path. Fluxa supports an optional HTTP/HTTPS CONNECT relay; it does **not** bundle or secretly depend on an author-controlled relay.

Set the relay as a Worker secret:

```bash
npx wrangler secret put UPSTREAM_PROXY
```

Example value:

```text
https://user:password@relay.example:8443
```

Optional Worker variable:

```text
UPSTREAM_PROXY_MODE=cloudflare   # use relay selectively for Cloudflare-hosted IPv4/IPv6 destinations
UPSTREAM_PROXY_MODE=always       # route all supported outbound TCP through relay
UPSTREAM_PROXY_MODE=off          # disable relay
```

See `docs/UPSTREAM_PROXY.md`.

## Deploy with Wrangler

Requirements: Node.js 22+ (Node 24 LTS recommended) and a Cloudflare account with Workers enabled.

```bash
npm install
npm run secrets
npx wrangler login
```

Set the mandatory generated values as Worker secrets:

```bash
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put SUB_TOKEN
npx wrangler secret put CLIENT_UUID
npx wrangler secret put TROJAN_PASSWORD
```

Create and bind KV (strongly recommended):

```bash
npx wrangler kv namespace create FLUXA_KV
```

Copy the namespace ID into `wrangler.jsonc` and uncomment the `kv_namespaces` binding.

> Workers KV is eventually consistent across Cloudflare locations. In v0.8, the Durable Object is authoritative for administrator control state, while KV remains the edge-readable cache used by stateless proxy/subscription requests; allow propagation time before assuming every PoP sees the newest configuration.

`wrangler.jsonc` declares `FLUXA_COORDINATOR`, a SQLite-backed Durable Object. Wrangler provisions it from the declarative `exports` entry. It serializes configuration mutations, rollback history, audit events and catalog commits, but it does **not** proxy client traffic.

Run the release gate before deployment:

```bash
npm run release-check
npm run deploy
```

After deployment, run the read-only smoke checker using environment variables (not shell arguments):

```bash
FLUXA_URL=https://YOUR-WORKER.workers.dev \
FLUXA_ADMIN_TOKEN='...' \
FLUXA_SUB_TOKEN='...' \
npm run smoke
```

## URLs

After deployment at `https://YOUR-WORKER.workers.dev`:

- Health: `/health`
- Capabilities: `/api/capabilities`
- Admin: `/admin`
- Admin config: `/api/config` — GET returns the current config plus an `ETag`; PUT requires that current value in `If-Match` on the official Durable-Object deployment
- Admin config history: `/api/config/history`
- Admin config rollback: `/api/config/rollback` — POST also requires the current config `If-Match` value
- Raw/auto subscription: `/sub/YOUR_SUB_TOKEN`
- Plain URIs: `/sub/YOUR_SUB_TOKEN?format=uri`
- Clash/Mihomo: `/sub/YOUR_SUB_TOKEN?format=clash`
- sing-box: `/sub/YOUR_SUB_TOKEN?format=singbox`
- Loon: `/sub/YOUR_SUB_TOKEN?format=loon`
- Surge: `/sub/YOUR_SUB_TOKEN?format=surge`
- VLESS WebSocket: `/ws/vless`
- Trojan WebSocket: `/ws/trojan`

The admin page stores `ADMIN_TOKEN` only in `sessionStorage` for the current browser tab.

## Quality configuration

```json
{
  "quality": {
    "minFluxScore": 60,
    "maxMisses": 2,
    "catalogMaxAgeMinutes": 360,
    "sourceTimeoutMs": 4500,
    "sourceAddressLimit": 256,
    "thirdPartyIpv4MustBeCloudflare": true
  }
}
```

Fluxa ships with **no author-controlled third-party IP source**. External sources are opt-in.

## GitHub maintenance baseline

- Direct development tools are pinned to exact versions instead of floating `^` ranges.
- GitHub CI tests supported Node.js 22 and 24.
- Dependabot checks npm and GitHub Actions monthly.
- CodeQL runs on pushes/PRs and weekly for JavaScript/TypeScript analysis.
- `npm run release-check` verifies runtime/package version alignment, exact direct toolchain versions, v0.8 control-plane/optimistic-lock wiring, the Durable Object declaration, CI Wrangler dry-run wiring, and obvious hard-coded secrets.

The source archive intentionally does not claim a lockfile that was not generated. Before a public release made from an Internet-connected maintainer machine, generate and review `package-lock.json` with the pinned toolchain and commit it for full transitive-dependency reproducibility.

## Verification status and limitations

Automated verification in v0.8.0 covers TypeScript compilation and **52** protocol/config/catalog/security/subscription/observability/reliability/coordinator/control-plane/security-boundary regression tests. GitHub CI/Release Gate is also configured to run `wrangler deploy --dry-run` with temporary CI-only secrets so Wrangler parses and bundles the actual Worker configuration. The dry-run cannot be claimed as locally executed in this build environment because the pinned Wrangler package cannot be installed here. None of these checks replaces a real deployment test.

Before calling a specific deployment production-verified, test it on a real Cloudflare account with the real clients you intend to use.

Current intentional limitations:

- TCP CONNECT only; UDP tunneling is not implemented.
- `FluxScore` is server-side confidence/quality evidence, not client physical latency.
- Surge output is Trojan-only because Fluxa only emits documented compatibility.
- Quantumult X native VLESS/Trojan generation is not claimed in v0.8.0; it will be added only with a verified interoperability fixture.
- XHTTP is not implemented yet.
- An upstream relay is external infrastructure supplied by the operator; its bandwidth/privacy/availability are outside Fluxa's control.

See `docs/CLIENT_COMPATIBILITY.md` and `DEPLOYMENT_CHECKLIST.md`.

## Roadmap

### Next milestone — real interoperability verification

Deploy v0.8 to a real Cloudflare account and run repeatable VLESS/Trojan connectivity plus Mihomo/Clash Verge, sing-box, Loon, Surge, v2rayN/v2rayNG and Shadowrocket import checks. Runtime findings should drive a focused v0.8.x fix or the next feature release.

### Later — evidence-based policy engine

Stability-first, quality-first and workload-specific policies should be built only after real interoperability evidence and, where applicable, client-assisted last-mile measurements.

### v1.0

Stable release after real Cloudflare deployment plus multi-client interoperability validation.

See `docs/CONTROL_PLANE_CONSISTENCY.md`, `docs/GLOBAL_COORDINATION.md`, `docs/CLIENT_COMPATIBILITY.md`, and `DEPLOYMENT_CHECKLIST.md`.

## License

MIT. See [LICENSE](LICENSE).
