# Fluxa client compatibility (v0.8.0)

Fluxa only claims a generated format where the corresponding client/protocol syntax is documented or where a standard URI bundle is used.

## Formats

| Query | Output | Protocols |
| --- | --- | --- |
| `format=raw` | base64-encoded URI list | VLESS, Trojan |
| `format=uri` | plain URI list | VLESS, Trojan |
| `format=clash` / `format=mihomo` | Mihomo/Clash YAML | VLESS, Trojan |
| `format=singbox` | sing-box JSON | VLESS, Trojan |
| `format=loon` | Loon config | VLESS, Trojan |
| `format=surge` | Surge config | Trojan |
| `format=v2rayn` / `v2rayng` / `shadowrocket` | raw URI subscription | VLESS, Trojan |
| `format=auto` | inferred from User-Agent | varies |

## Why Surge is Trojan-only

Surge documentation explicitly describes Trojan and Trojan WebSocket parameters. Fluxa does not generate an undocumented VLESS policy for Surge just to inflate its support matrix.

## Why Quantumult X is not claimed yet

Fluxa v0.8.0 does not claim native Quantumult X VLESS/Trojan support without a verified, current interoperability fixture. A generic URI may be accepted by some workflows, but Fluxa's project policy is to distinguish “possibly importable” from “verified generator format.”

## UDP

Fluxa's proxy core is TCP-only in v0.8.0, so generated client profiles keep UDP disabled where the format exposes an explicit UDP switch.

## Real-world verification

Automated tests validate generated structure and security invariants. A real deployment should still import the generated subscription into the target client and establish actual connections before that client/version combination is marked verified.
