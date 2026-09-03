import { isValidPublicHostname } from "./security.js";

interface CloudflareIpsResponse {
  success?: boolean;
  result?: { ipv4_cidrs?: string[]; ipv6_cidrs?: string[] };
}

export interface SourceSnapshot {
  url: string;
  ok: boolean;
  durationMs: number;
  rawItems: number;
  parsedAddresses: string[];
  error?: string;
}

let cfCache: { expires: number; ipv4: string[]; ipv6: string[] } | undefined;
const sourceCache = new Map<string, { expires: number; snapshot: SourceSnapshot }>();
const CLOUDFLARE_IP_API_TIMEOUT_MS = 4_500;

export async function fetchCloudflareCidrs(): Promise<{ ipv4: string[]; ipv6: string[] }> {
  const now = Date.now();
  if (cfCache && cfCache.expires > now) return { ipv4: [...cfCache.ipv4], ipv6: [...cfCache.ipv6] };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLOUDFLARE_IP_API_TIMEOUT_MS);
  try {
    const r = await fetch("https://api.cloudflare.com/client/v4/ips", { signal: controller.signal, headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`Cloudflare IP API returned ${r.status}`);
    const body = await r.json() as CloudflareIpsResponse;
    const ipv4 = body.result?.ipv4_cidrs?.filter((x) => /^\d+\.\d+\.\d+\.\d+\/\d+$/.test(x)) ?? [];
    const ipv6 = body.result?.ipv6_cidrs?.filter((x) => /^[0-9a-f:]+\/\d+$/i.test(x)) ?? [];
    if (!ipv4.length) throw new Error("Cloudflare IP API returned no IPv4 CIDRs");
    cfCache = { expires: now + 6 * 60 * 60 * 1000, ipv4, ipv6 };
    return { ipv4: [...ipv4], ipv6: [...ipv6] };
  } catch (error) {
    // A previously validated range list is safer than dropping all CIDR knowledge
    // during a temporary Cloudflare API outage. The next invocation will retry.
    if (cfCache?.ipv4.length) return { ipv4: [...cfCache.ipv4], ipv6: [...cfCache.ipv6] };
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchCloudflareIpv4Cidrs(): Promise<string[]> {
  return (await fetchCloudflareCidrs()).ipv4;
}

export async function fetchCloudflareIpv6Cidrs(): Promise<string[]> {
  const ipv6 = (await fetchCloudflareCidrs()).ipv6;
  if (!ipv6.length) throw new Error("Cloudflare IP API returned no IPv6 CIDRs");
  return ipv6;
}

export async function fetchSourceSnapshot(url: string, timeoutMs = 4500, limit = 256): Promise<SourceSnapshot> {
  const cached = sourceCache.get(url);
  if (cached && cached.expires > Date.now()) return cached.snapshot;
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetchSourceUrl(url, controller.signal);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const text = await readTextLimited(r, 256 * 1024);
    const rawItems = countRawItems(text);
    const parsedAddresses = parseSourceText(text).slice(0, limit);
    const snapshot: SourceSnapshot = { url, ok: true, durationMs: Date.now() - started, rawItems, parsedAddresses };
    sourceCache.set(url, { expires: Date.now() + 10 * 60 * 1000, snapshot });
    return snapshot;
  } catch (error) {
    return { url, ok: false, durationMs: Date.now() - started, rawItems: 0, parsedAddresses: [], error: error instanceof Error ? error.message : "source fetch failed" };
  } finally { clearTimeout(timeout); }
}

export function parseSourceText(text: string): string[] {
  const out = new Set<string>();
  const tokens = text.split(/[\r\n,\t ]+/);
  for (let raw of tokens) {
    raw = raw.trim();
    if (!raw || raw.startsWith("#") || raw.startsWith("//")) continue;
    try {
      if (/^(vless|trojan):\/\//i.test(raw)) raw = new URL(raw).hostname;
    } catch { continue; }
    raw = raw.split("#", 1)[0];
    if (raw.startsWith("[")) {
      const end = raw.indexOf("]");
      if (end > 0) raw = raw.slice(1, end);
    } else {
      const m = raw.match(/^([^:]+):\d+$/);
      if (m) raw = m[1];
    }
    raw = stripBrackets(raw);
    if (raw.length <= 253 && isValidPublicHostname(raw)) out.add(raw);
  }
  return [...out];
}

export function sampleIpv4Stable(cidrs: string[], count: number): string[] {
  if (!cidrs.length || count <= 0) return [];
  const out = new Set<string>();
  for (let i = 0; out.size < count && i < count * 12 + cidrs.length; i++) {
    const cidr = cidrs[i % cidrs.length];
    const ip = deterministicIpFromCidr(cidr, hash32(`${cidr}:${i}`));
    if (ip) out.add(ip);
  }
  return [...out];
}

export function sampleIpv4(cidrs: string[], count: number): string[] {
  if (!cidrs.length || count <= 0) return [];
  const out = new Set<string>();
  let guard = count * 8 + 32;
  while (out.size < count && guard-- > 0) {
    const cidr = cidrs[randomInt(cidrs.length)];
    const ip = randomIpFromCidr(cidr);
    if (ip) out.add(ip);
  }
  return [...out];
}

export function randomIpFromCidr(cidr: string): string | null {
  return deterministicIpFromCidr(cidr, crypto.getRandomValues(new Uint32Array(1))[0]);
}

export function isIpv4(value: string): boolean { return ipv4ToUint(value) !== null; }


export function isIpv6(value: string): boolean { return ipv6ToBigInt(stripBrackets(value)) !== null; }

export function isIpv6InCidrs(ip: string, cidrs: string[]): boolean {
  const n = ipv6ToBigInt(stripBrackets(ip));
  if (n === null) return false;
  for (const cidr of cidrs) {
    const slash = cidr.lastIndexOf("/");
    if (slash <= 0) continue;
    const base = ipv6ToBigInt(cidr.slice(0, slash));
    const bits = Number(cidr.slice(slash + 1));
    if (base === null || !Number.isInteger(bits) || bits < 0 || bits > 128) continue;
    if (bits === 0) return true;
    const shift = BigInt(128 - bits);
    if ((n >> shift) === (base >> shift)) return true;
  }
  return false;
}
export function isIpv4InCidrs(ip: string, cidrs: string[]): boolean {
  const n = ipv4ToUint(ip);
  if (n === null) return false;
  for (const cidr of cidrs) {
    const [baseText, bitsText] = cidr.split("/");
    const base = ipv4ToUint(baseText);
    const bits = Number(bitsText);
    if (base === null || !Number.isInteger(bits) || bits < 0 || bits > 32) continue;
    const hostBits = 32 - bits;
    const mask = bits === 0 ? 0 : (0xffffffff << hostBits) >>> 0;
    if ((n & mask) === (base & mask)) return true;
  }
  return false;
}

async function fetchSourceUrl(input: string, signal: AbortSignal): Promise<Response> {
  let current = new URL(input);
  for (let redirects = 0; redirects <= 2; redirects++) {
    if (current.protocol !== "https:" || current.username || current.password || !isValidPublicHostname(current.hostname)) {
      throw new Error("unsafe source URL or redirect target");
    }
    const response = await fetch(current.toString(), {
      signal,
      headers: { accept: "text/plain,*/*;q=0.5" },
      redirect: "manual"
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) throw new Error("source redirect missing Location header");
    if (redirects === 2) throw new Error("too many source redirects");
    current = new URL(location, current);
  }
  throw new Error("too many source redirects");
}

async function readTextLimited(response: Response, limit: number): Promise<string> {
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > limit) throw new Error("source is too large");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.length;
      if (size > limit) throw new Error("source is too large");
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const merged = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(merged);
}

function countRawItems(text: string): number {
  return text.split(/[\r\n,\t ]+/).map((x) => x.trim()).filter((x) => x && !x.startsWith("#") && !x.startsWith("//")).length;
}

function deterministicIpFromCidr(cidr: string, entropy: number): string | null {
  const [ip, bitsText] = cidr.split("/");
  const bits = Number(bitsText);
  if (!ip || !Number.isInteger(bits) || bits < 0 || bits > 32) return null;
  const base = ipv4ToUint(ip);
  if (base === null) return null;
  const hostBits = 32 - bits;
  const mask = bits === 0 ? 0 : (0xffffffff << hostBits) >>> 0;
  const network = base & mask;
  const hostMask = hostBits === 32 ? 0xffffffff : (2 ** hostBits - 1) >>> 0;
  let host = entropy & hostMask;
  if (hostBits >= 2) {
    if (host === 0) host = 1;
    if (host === hostMask) host = Math.max(1, hostMask - 1);
  }
  return uintToIpv4((network | host) >>> 0);
}

function ipv4ToUint(ip: string): number | null {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return null;
  return (((p[0] << 24) >>> 0) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}
function ipv6ToBigInt(input: string): bigint | null {
  let value = input.trim().toLowerCase();
  if (!value || value.includes("%")) return null;
  if (value.includes(".")) {
    const lastColon = value.lastIndexOf(":");
    if (lastColon < 0) return null;
    const v4 = ipv4ToUint(value.slice(lastColon + 1));
    if (v4 === null) return null;
    const hi = ((v4 >>> 16) & 0xffff).toString(16);
    const lo = (v4 & 0xffff).toString(16);
    value = `${value.slice(0, lastColon)}:${hi}:${lo}`;
  }
  if (!/^[0-9a-f:]+$/i.test(value) || value.split("::").length > 2) return null;
  const [leftText, rightText] = value.split("::");
  const left = leftText ? leftText.split(":") : [];
  const right = rightText !== undefined && rightText ? rightText.split(":") : [];
  if ([...left, ...right].some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  let groups: string[];
  if (rightText !== undefined) {
    const missing = 8 - left.length - right.length;
    if (missing < 1) return null;
    groups = [...left, ...Array(missing).fill("0"), ...right];
  } else {
    if (left.length !== 8) return null;
    groups = left;
  }
  let result = 0n;
  for (const group of groups) result = (result << 16n) | BigInt(parseInt(group, 16));
  return result;
}

function uintToIpv4(n: number): string { return `${n>>>24}.${(n>>>16)&255}.${(n>>>8)&255}.${n&255}`; }
function randomInt(max: number): number { return crypto.getRandomValues(new Uint32Array(1))[0] % max; }
function stripBrackets(v: string): string { return v.replace(/^\[|\]$/g, ""); }
function hash32(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) { h ^= value.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
