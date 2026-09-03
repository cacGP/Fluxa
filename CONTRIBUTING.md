# Contributing

1. Fork the repository and create a focused branch.
2. Run `npm run release-check` before opening a pull request.
3. Never commit real tokens, UUIDs, passwords, subscription URLs, relay credentials, or Cloudflare account identifiers.
4. Protocol/subscription changes must include regression tests and should cite current client documentation or provide a reproducible interoperability fixture.
5. Do not claim a client is supported merely because a generated string looks plausible; distinguish structural generation from real import/connectivity verification.
6. New node sources must be opt-in unless they are an authoritative first-party source.
7. Do not weaken TLS, credential separation, private-target blocking, or source validation defaults without a documented security rationale.

8. Keep direct development tool versions exact (no `^`/`~` ranges). Dependabot should carry routine toolchain updates through CI.
9. Use a currently supported Node.js LTS line; Fluxa v0.8 supports Node 22+ and CI targets Node 22/24.

10. Custom tooling that mutates `/api/config` or `/api/config/rollback` must preserve the config `ETag` from `GET /api/config` and send it as `If-Match`; do not bypass optimistic concurrency in new code.
