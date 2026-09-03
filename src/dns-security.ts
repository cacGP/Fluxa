import { fetchCloudflareCidrs, isIpv4, isIpv4InCidrs, isIpv6, isIpv6InCidrs } from "./nodes.js";
import { isValidPublicHostname } from "./security.js";

export type DnsRecordType = "A" | "AAAA";
export type DnsResolver = (host: string, type: DnsRecordType) => Promise<string[]>;

export interface ResolvedPublicTarget {
  originalHost: string;
  addresses: string[];
  selectedAddress: string;
}

const dnsCache = new Map<string, { expires: number; ips: string[] }>();
const DNS_TIMEOUT_MS = 3_500;

export async function resolvePublicTarget(host: string, resolver: DnsResolver = resolveDnsRecords): Promise<ResolvedPublicTarget> {
  const normalized = stripBrackets(host.trim().toLowerCase());
  if (!isValidPublicHostname(normalized)) throw new Error("target is not a valid public hostname or IP");
  if (isIpv4(normalized) || isIpv6(normalized)) {
    return { originalHost: normalized, addresses: [normalized], selectedAddress: normalized };
  }

  const [v4Result, v6Result] = await Promise.allSettled([resolver(normalized, "A"), resolver(normalized, "AAAA")]);
  const addresses = [...new Set([
    ...(v4Result.status === "fulfilled" ? v4Result.value : []),
    ...(v6Result.status === "fulfilled" ? v6Result.value : [])
  ].map((x) => stripBrackets(x.trim().toLowerCase())).filter(Boolean))];

  if (!addresses.length) throw new Error("target DNS resolution returned no address");
  if (addresses.some((ip) => !(isIpv4(ip) || isIpv6(ip)) || !isValidPublicHostname(ip))) {
    throw new Error("target DNS includes a non-public or invalid address");
  }

  const selectedAddress = addresses.find(isIpv4) ?? addresses[0];
  return { originalHost: normalized, addresses, selectedAddress };
}

export async function resolvedTargetMayBeCloudflare(target: ResolvedPublicTarget): Promise<boolean> {
  try {
    const ranges = await fetchCloudflareCidrs();
    return target.addresses.some((ip) => isIpv4(ip)
      ? isIpv4InCidrs(ip, ranges.ipv4)
      : isIpv6(ip) && isIpv6InCidrs(ip, ranges.ipv6));
  } catch { return false; }
}

export async function destinationMayBeCloudflare(host: string): Promise<boolean> {
  try { return resolvedTargetMayBeCloudflare(await resolvePublicTarget(host)); }
  catch { return false; }
}

async function resolveDnsRecords(host: string, type: DnsRecordType): Promise<string[]> {
  const key = `${type}:${host}`;
  const cached = dnsCache.get(key);
  if (cached && cached.expires > Date.now()) return [...cached.ips];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DNS_TIMEOUT_MS);
  try {
    const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`;
    const r = await fetch(url, { signal: controller.signal, headers: { accept: "application/dns-json" } });
    if (!r.ok) throw new Error(`DoH returned ${r.status}`);
    const body = await r.json() as { Status?: number; Answer?: Array<{ type?: number; TTL?: number; data?: string }> };
    if (body.Status !== 0) throw new Error(`DoH status ${body.Status}`);
    const expected = type === "A" ? 1 : 28;
    const answers = (body.Answer ?? []).filter((a) => a.type === expected && typeof a.data === "string");
    const ips = [...new Set(answers.map((a) => String(a.data)))];
    const ttl = answers.length ? Math.min(...answers.map((a) => Math.max(30, Math.min(3600, Number(a.TTL ?? 300))))) : 60;
    dnsCache.set(key, { expires: Date.now() + ttl * 1000, ips });
    return [...ips];
  } finally { clearTimeout(timer); }
}

function stripBrackets(value: string): string { return value.replace(/^\[|\]$/g, ""); }
