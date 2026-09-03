# Fluxa v0.8.0 deployment checklist

## Before deploy

- [ ] Read `README.md`, `SECURITY.md`, and `docs/CLIENT_COMPATIBILITY.md`.
- [ ] Use Node.js 22 or 24.
- [ ] Run `npm install`.
- [ ] For a public GitHub release, generate/review/commit `package-lock.json` from an Internet-connected maintainer environment so transitive dependencies are reproducible.
- [ ] Run `npm run release-check`; all tests, control-plane release assertions and the secret scan must pass.
- [ ] On an Internet-connected environment, also run `npx wrangler deploy --dry-run --outdir .wrangler-dry-run --secrets-file <CI-ONLY-OR-LOCAL-TEST-SECRETS>` or rely on the checked-in GitHub CI dry-run before publishing a release.
- [ ] Generate unique `ADMIN_TOKEN`, `SUB_TOKEN`, `CLIENT_UUID`, and `TROJAN_PASSWORD`.
- [ ] Store the four mandatory values as Worker secrets, not plaintext vars.
- [ ] Create and bind `FLUXA_KV` (required for the official persistent control plane and strongly recommended for catalog/config edge caching).
- [ ] Keep the checked-in `FLUXA_COORDINATOR` Durable Object binding and SQLite `exports` declaration; Wrangler provisions the authoritative v0.8 control-plane object automatically.
- [ ] If using `UPSTREAM_PROXY`, store it as a Worker secret and understand that relay's trust/privacy model.

## Immediately after deploy

- [ ] Open `/health` and confirm version `0.8.0`.
- [ ] Open `/api/capabilities` and confirm expected formats and reliability flags.
- [ ] Open `/admin`, enter `ADMIN_TOKEN`, then run Diagnostics.
- [ ] Refresh the node catalog and confirm eligible nodes exist.
- [ ] Confirm `/api/audit` contains the manual refresh event and no secret values.
- [ ] GET `/api/config` with administrator auth and confirm it returns an ETag such as `"fluxa-config-1"`.
- [ ] Save one harmless configuration change in the admin UI, open “配置历史”, and confirm the previous configuration is snapshotted and the config ETag/revision advances.
- [ ] Open the admin page in two tabs, load config in both, save from tab A, then attempt a stale save from tab B; confirm the stale write is rejected and tab B asks for reload.

## Automated HTTP smoke check

Pass credentials through environment variables, not command-line arguments:

```bash
FLUXA_URL=https://YOUR-WORKER.workers.dev \
FLUXA_ADMIN_TOKEN='...' \
FLUXA_SUB_TOKEN='...' \
npm run smoke
```

The smoke checker is read-only. It verifies health/version, v0.8 control-plane capability flags, administrator authorization boundaries, the config revision ETag, all subscription HEAD endpoints, subscription ETag metadata, and wrong-token 404 behavior.

## Client smoke tests

Use the real clients you intend to support.

- [ ] Raw URI/base64 client: import `/sub/SUB_TOKEN?format=raw`.
- [ ] Mihomo/Clash: import `?format=clash` and establish a TCP web connection.
- [ ] sing-box: import `?format=singbox` and establish a TCP web connection.
- [ ] Loon: import `?format=loon` if Loon is part of your target matrix.
- [ ] Surge: import `?format=surge`; verify Trojan WS connectivity.
- [ ] Confirm generated clients do not default to DIRECT as their Fluxa selector.
- [ ] Confirm TLS verification remains enabled.
- [ ] Confirm UDP is not presented as supported by Fluxa v0.8.0.

## Security and recovery smoke tests

- [ ] Wrong `SUB_TOKEN` returns 404.
- [ ] `SUB_TOKEN` cannot access `/api/config`, `/api/audit`, `/api/diagnostics`, or config history.
- [ ] Wrong/missing `ADMIN_TOKEN` returns 401 for administrator APIs.
- [ ] Private/localhost proxy targets are rejected.
- [ ] Third-party source URLs are HTTPS-only.
- [ ] Perform one test rollback and confirm the current configuration is snapshotted before rollback.

## Production verification rule

Do not label a deployment “production verified” until at least one real Cloudflare deployment and each claimed client/version has completed an actual import + connection test.


## v0.6+ reliability/security checks

- [ ] Confirm `/api/capabilities` reports `upstreamDnsPinning: true`, `reservedProxyRoutes: true`, and `cspNonce: true`.
- [ ] Confirm an oversized or non-JSON configuration PUT is rejected.
- [ ] Confirm proxy paths such as `/api/config`, `/sub/example`, `/admin`, and `/health` are normalized away from reserved routes.
- [ ] If using `UPSTREAM_PROXY`, verify the relay receives a validated IP address in CONNECT rather than the original client-supplied hostname.
- [ ] Confirm `/api/capabilities` reports `refreshSingleFlight: true`, `globalRefreshCoordinator: true`, `hostIsolatedCatalog: true`, `staleIfRefreshError: true`, a 15-second proxy handshake timeout, and the 4 MiB WebSocket frame ceiling.
- [ ] Confirm Diagnostics reports the catalog was generated from the current configuration.
- [ ] After a config change, allow for Workers KV eventual-consistency propagation across Cloudflare locations instead of assuming immediate global visibility.


## v0.7 global-coordination checks

- [ ] Deploy through the checked-in `wrangler.jsonc` and confirm the `FluxaCoordinator` SQLite-backed Durable Object is provisioned.
- [ ] Diagnostics reports the `coordinator` check as `ok`.
- [ ] With both a `workers.dev` hostname and a custom domain, confirm each subscription starts with the hostname used for that request and does not leak the other hostname from a shared catalog.
- [ ] Temporarily make a source refresh fail and confirm an existing stale catalog remains usable; with no usable catalog, a subscription still contains the current Worker/custom-domain hostname rather than returning a server error.


## v0.8 control-plane checks

- [ ] `/api/capabilities` reports `controlPlaneConsistency: true`, `optimisticConfigWrites: true`, and `staleCatalogCommitGuard: true`.
- [ ] Diagnostics reports the Durable Object as the global Fluxa control plane, not only a catalog-refresh lock.
- [ ] A custom API client GETs `/api/config`, preserves its ETag, and sends it in `If-Match` for PUT `/api/config` or POST `/api/config/rollback`.
- [ ] Missing `If-Match` is rejected on official Durable Object control-plane mutations.
- [ ] A stale ETag is rejected with `412 Precondition Failed`; it must not overwrite the newer config.
- [ ] After an accepted config edit, a catalog refresh that started under the older config cannot commit its stale result.
