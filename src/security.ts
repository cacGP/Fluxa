const encoder = new TextEncoder();

export function constantTimeEqual(a: string, b: string): boolean {
  const aa = encoder.encode(a);
  const bb = encoder.encode(b);
  const len = Math.max(aa.length, bb.length);
  let diff = aa.length ^ bb.length;
  for (let i = 0; i < len; i++) diff |= (aa[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

export function isAdmin(request: Request, token: string): boolean {
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return false;
  return constantTimeEqual(auth.slice(7), token);
}

export function validUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function isValidPublicHostname(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!h || h.length > 253 || /[\x00-\x20\x7f/?#@]/.test(h) || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return false;
  if (looksLikeIpv4(h)) return !isBlockedIpv4(h);
  if (h.includes(":")) return ipv6ToBigInt(h) !== null && !isBlockedIpv6(h);
  if (!/^[a-z0-9.-]+$/i.test(h) || h.startsWith(".") || h.endsWith(".") || h.includes("..")) return false;
  const labels = h.split(".");
  return labels.every((label) => label.length >= 1 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
}

function looksLikeIpv4(host: string): boolean { return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host); }

/**
 * Reject IPv4 ranges that are not suitable as public Internet proxy targets.
 * This intentionally follows the non-global/special-purpose families rather
 * than broad textual prefixes so legitimate public 192.0.x.x space is not
 * accidentally rejected.
 */
function isBlockedIpv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const p = m.slice(1).map(Number);
  if (p.some((x) => x > 255)) return true;
  const [a, b, c] = p;
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224;
}

const BLOCKED_IPV6_CIDRS: ReadonlyArray<readonly [string, number]> = [
  ["::", 128],                    // unspecified
  ["::1", 128],                   // loopback
  ["::ffff:0:0", 96],             // IPv4-mapped IPv6
  ["64:ff9b:1::", 48],            // local-use IPv4/IPv6 translation
  ["100::", 64],                  // discard-only
  ["2001:2::", 48],               // benchmarking
  ["2001:10::", 28],              // deprecated ORCHID
  ["2001:20::", 28],              // ORCHIDv2
  ["2001:db8::", 32],             // documentation
  ["fc00::", 7],                  // unique local
  ["fe80::", 10],                 // link-local
  ["ff00::", 8]                   // multicast
];

function isBlockedIpv6(host: string): boolean {
  const value = ipv6ToBigInt(host);
  if (value === null) return true;
  return BLOCKED_IPV6_CIDRS.some(([baseText, bits]) => {
    const base = ipv6ToBigInt(baseText);
    if (base === null) return false;
    if (bits === 0) return true;
    const shift = BigInt(128 - bits);
    return (value >> shift) === (base >> shift);
  });
}

function ipv6ToBigInt(input: string): bigint | null {
  let value = input.trim().toLowerCase();
  if (!value || value.includes("%")) return null;

  if (value.includes(".")) {
    const lastColon = value.lastIndexOf(":");
    if (lastColon < 0) return null;
    const ipv4 = value.slice(lastColon + 1);
    const parts = ipv4.split(".").map(Number);
    if (parts.length !== 4 || parts.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return null;
    const hi = ((parts[0] << 8) | parts[1]).toString(16);
    const lo = ((parts[2] << 8) | parts[3]).toString(16);
    value = `${value.slice(0, lastColon)}:${hi}:${lo}`;
  }

  if ((value.match(/::/g) ?? []).length > 1) return null;
  const hasCompression = value.includes("::");
  const [leftText, rightText = ""] = value.split("::");
  const left = leftText ? leftText.split(":") : [];
  const right = rightText ? rightText.split(":") : [];
  if ((!hasCompression && left.length !== 8) || (hasCompression && left.length + right.length >= 8)) return null;
  if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/i.test(part))) return null;
  const zeros = hasCompression ? 8 - left.length - right.length : 0;
  const parts = [...left, ...Array.from({ length: zeros }, () => "0"), ...right];
  if (parts.length !== 8) return null;
  let out = 0n;
  for (const part of parts) out = (out << 16n) | BigInt(parseInt(part, 16));
  return out;
}

export function sanitizePath(path: string, fallback: string): string {
  const p = path.trim();
  if (!/^\/[a-zA-Z0-9/_-]{1,80}$/.test(p)) return fallback;
  return p;
}
