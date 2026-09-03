import { CONFIG_KEY, DEFAULT_CONFIG, LEGACY_CONFIG_KEY } from "./constants.js";
import { sanitizePath, isValidPublicHostname } from "./security.js";
import type { Env, FluxaConfig } from "./types.js";

export async function loadConfig(env: Env): Promise<FluxaConfig> {
  if (!env.FLUXA_KV) return structuredClone(DEFAULT_CONFIG);
  const raw = await env.FLUXA_KV.get(CONFIG_KEY) ?? await env.FLUXA_KV.get(LEGACY_CONFIG_KEY);
  if (!raw) return structuredClone(DEFAULT_CONFIG);
  try { return validateConfig(JSON.parse(raw)); }
  catch { return structuredClone(DEFAULT_CONFIG); }
}

export async function saveConfig(env: Env, input: unknown): Promise<FluxaConfig> {
  if (!env.FLUXA_KV) throw new Error("FLUXA_KV is not bound; persistent configuration is unavailable.");
  const config = validateConfig(input);
  await env.FLUXA_KV.put(CONFIG_KEY, JSON.stringify(config));
  return config;
}

export function validateConfig(input: unknown): FluxaConfig {
  const x = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const protocols = objectOf(x.protocols);
  const paths = objectOf(x.paths);
  const quality = objectOf(x.quality);

  const title = stringOf(x.title, DEFAULT_CONFIG.title).slice(0, 48) || DEFAULT_CONFIG.title;
  const allowedTargetPorts = uniqueNumbers(x.allowedTargetPorts, DEFAULT_CONFIG.allowedTargetPorts)
    .filter((p) => Number.isInteger(p) && p >= 1 && p <= 65535).slice(0, 32);
  const edgeAddresses = uniqueStrings(x.edgeAddresses).filter(validEdgeAddress).slice(0, 128);
  const sourceUrls = uniqueStrings(x.sourceUrls).filter(validSourceUrl).slice(0, 16);

  let vlessPath = safeProxyPath(stringOf(paths.vless, DEFAULT_CONFIG.paths.vless), DEFAULT_CONFIG.paths.vless);
  let trojanPath = safeProxyPath(stringOf(paths.trojan, DEFAULT_CONFIG.paths.trojan), DEFAULT_CONFIG.paths.trojan);
  if (vlessPath === trojanPath) {
    trojanPath = DEFAULT_CONFIG.paths.trojan !== vlessPath ? DEFAULT_CONFIG.paths.trojan : "/ws/trojan-alt";
  }

  return {
    schemaVersion: 2,
    title,
    protocols: {
      vless: boolOf(protocols.vless, true),
      trojan: boolOf(protocols.trojan, true)
    },
    paths: {
      vless: vlessPath,
      trojan: trojanPath
    },
    allowedTargetPorts: allowedTargetPorts.length ? allowedTargetPorts : [...DEFAULT_CONFIG.allowedTargetPorts],
    edgeAddresses,
    officialIpCount: boundedInt(x.officialIpCount, DEFAULT_CONFIG.officialIpCount, 0, 64),
    maxSubscriptionNodes: boundedInt(x.maxSubscriptionNodes, DEFAULT_CONFIG.maxSubscriptionNodes, 1, 128),
    sourceUrls,
    quality: {
      minFluxScore: boundedInt(quality.minFluxScore, DEFAULT_CONFIG.quality.minFluxScore, 0, 100),
      maxMisses: boundedInt(quality.maxMisses, DEFAULT_CONFIG.quality.maxMisses, 0, 10),
      catalogMaxAgeMinutes: boundedInt(quality.catalogMaxAgeMinutes, DEFAULT_CONFIG.quality.catalogMaxAgeMinutes, 30, 1440),
      sourceTimeoutMs: boundedInt(quality.sourceTimeoutMs, DEFAULT_CONFIG.quality.sourceTimeoutMs, 1000, 10000),
      sourceAddressLimit: boundedInt(quality.sourceAddressLimit, DEFAULT_CONFIG.quality.sourceAddressLimit, 16, 512),
      thirdPartyIpv4MustBeCloudflare: boolOf(quality.thirdPartyIpv4MustBeCloudflare, DEFAULT_CONFIG.quality.thirdPartyIpv4MustBeCloudflare)
    }
  };
}

function objectOf(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
}
function stringOf(v: unknown, fallback: string): string { return typeof v === "string" ? v : fallback; }
function boolOf(v: unknown, fallback: boolean): boolean { return typeof v === "boolean" ? v : fallback; }
function boundedInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? Math.trunc(v) : fallback;
  return Math.max(min, Math.min(max, n));
}
function uniqueStrings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean))];
}
function uniqueNumbers(v: unknown, fallback: number[]): number[] {
  if (!Array.isArray(v)) return [...fallback];
  return [...new Set(v.filter((x): x is number => typeof x === "number"))];
}
function validEdgeAddress(v: string): boolean {
  if (v.length > 253 || /[\s/?#]/.test(v)) return false;
  return /^[a-z0-9.-]+$/i.test(v) || /^\[[0-9a-f:]+\]$/i.test(v);
}
function validSourceUrl(v: string): boolean {
  try { const u = new URL(v); return u.protocol === "https:" && u.username === "" && u.password === "" && isValidPublicHostname(u.hostname); }
  catch { return false; }
}

const RESERVED_PROXY_PATHS = ["/", "/admin", "/health", "/api", "/sub"];
function safeProxyPath(value: string, fallback: string): string {
  const sanitized = sanitizePath(value, fallback);
  const lower = sanitized.toLowerCase();
  const reserved = RESERVED_PROXY_PATHS.some((prefix) => lower === prefix || lower.startsWith(prefix + "/"));
  return reserved ? fallback : sanitized;
}
