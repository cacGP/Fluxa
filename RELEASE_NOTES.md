# Fluxa v0.8.0 release notes

Fluxa v0.8.0 is a **control-plane consistency and release-verification release**. It intentionally does not add another proxy protocol.

## Highlights

- `FluxaCoordinator` is now the authoritative low-frequency writer for config mutations, rollback history and administrator audit events.
- Workers KV remains the edge-readable cache for fast stateless data-plane requests; ordinary VLESS/Trojan traffic still never crosses the Durable Object.
- Admin configuration uses monotonic revisions plus HTTP `ETag` / `If-Match`. A stale browser tab receives `412 Precondition Failed` instead of silently overwriting a newer config.
- Catalog refreshes use optimistic commit protection. Slow source discovery can run while config changes, but a refresh built from an older config is rejected before the catalog KV write.
- Pre-v0.8 KV config history/audit are imported once when the new Durable Object control state is initialized.
- GitHub CI and Release Gate now run `wrangler deploy --dry-run` with temporary CI-only secrets so Cloudflare bundling/config parsing is checked before a release artifact is built.

## Verification

- TypeScript compile: pass
- Node regression suite: **52/52 pass**
- Release secret scan/version/toolchain checks: pass locally
- Wrangler dry-run: configured for GitHub CI/Release Gate; this environment cannot install the pinned Wrangler package from npm, so the dry-run cannot be truthfully claimed as executed here
- Real Cloudflare deployment + real-client traffic: still required before calling a deployment production-verified

## Upgrade note

The official v0.8 admin UI automatically sends `If-Match` after loading config. Custom scripts that PUT `/api/config` or POST `/api/config/rollback` against an official Durable-Object deployment must first GET `/api/config`, preserve its `ETag`, and send that value as `If-Match` with the mutation.

Existing KV config remains compatible. The Durable Object bootstraps its authoritative control state from the current KV config and imports legacy rollback/audit records once.
