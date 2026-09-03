# Fluxa quality engine (v0.5)

`FluxScore` is a confidence score from 0 to 100 for **shared catalog candidates**. It is not a client-side latency measurement. The current Worker/custom-domain hostname is always added dynamically to a subscription and is not persisted or scored in the shared catalog.

## Evidence

- Manual address configured by the operator: high trust.
- IPv4 sampled from Cloudflare's official CIDRs: trusted network membership, but not guaranteed client performance.
- Third-party source: weighted by that source's historical reputation.
- Third-party IPv4 inside Cloudflare's official CIDRs: additional confidence.
- Same candidate appearing in more than one configured source: recurrence bonus.
- Candidate missing in successive refreshes: score penalty and eventual retirement.

## Source reputation

Each source records:

- attempts and successes;
- consecutive failures;
- latest fetch duration;
- raw item count;
- parsed candidate count;
- accepted candidate count;
- reputation score (0-100) and grade A-F.

The calculation uses a smoothed success rate so a brand-new source cannot instantly receive perfect trust after a single successful fetch.

## Automatic retirement

A candidate that disappears from refreshes accumulates `misses`. When `misses > quality.maxMisses`, its state becomes `retired` and it is no longer emitted to subscriptions. The record remains in the catalog so the operator can understand why it disappeared.

## Why no Worker-side Cloudflare-IP TCP latency number?

Cloudflare documents that Workers raw TCP sockets cannot connect to Cloudflare-owned IP ranges. A Worker-side `connect()` benchmark to those candidate edge IPs would therefore be invalid. Actual edge latency is also user/ISP/location dependent. A future client-assisted probe can add real last-mile measurements without mislabeling server-side evidence as user latency.
