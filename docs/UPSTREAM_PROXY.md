# Optional upstream HTTP CONNECT relay

Cloudflare Workers block raw outbound TCP sockets to Cloudflare-owned IP ranges. For TCP tunnel traffic whose final target is itself behind Cloudflare, Fluxa can route the outbound leg through an operator-supplied HTTP CONNECT proxy.

## Secret

Set `UPSTREAM_PROXY` as a Worker secret, for example:

```text
https://user:password@relay.example:8443
```

Supported schemes: `http://` and `https://`.

The relay hostname must be public. Do not point the relay hostname at the same Worker or at a Cloudflare-proxied hostname, because that can recreate the platform's blocked/looping first hop.

## Modes

- `cloudflare` — selective mode; default when `UPSTREAM_PROXY` exists.
- `always` — route every allowed TCP destination through the relay.
- `off` — disable the relay.

## Selective detection

For hostnames, Fluxa queries Cloudflare DoH A and AAAA records and compares returned IPv4/IPv6 addresses with Cloudflare's official CIDRs. IPv6 literals are checked against the official IPv6 list as well. If detection fails, Fluxa tries the direct route; if that direct socket fails and a relay is configured, selective mode may fall back to the relay. Direct socket opening and the upstream CONNECT handshake are each bounded to 10 seconds.

Before using the relay, Fluxa resolves A and AAAA records and refuses a destination if the DNS result includes a blocked private/link-local/special-use address. This is defense-in-depth against turning the relay into an internal-network pivot.

## Trust boundary

The upstream relay can observe connection metadata and carries the tunneled TCP stream. Fluxa does not provide a built-in author-controlled relay. The operator is responsible for choosing and securing this infrastructure.
