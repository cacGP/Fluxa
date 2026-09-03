import { CATALOG_KEY } from "./constants.js";
import { fetchCloudflareIpv4Cidrs, fetchSourceSnapshot, isIpv4, isIpv4InCidrs, sampleIpv4Stable, type SourceSnapshot } from "./nodes.js";
import { isValidPublicHostname } from "./security.js";
import { mapWithConcurrency } from "./async-utils.js";
import type { Env, FluxaConfig, NodeCandidate, NodeCatalog, NodeOrigin, NodeStatus, SourceHealth } from "./types.js";

interface Evidence {
  address: string;
  origins: Set<NodeOrigin>;
  sources: Set<string>;
  cloudflareIpv4: boolean;
}

export async function loadNodeCatalog(env: Env): Promise<NodeCatalog | null> {
  if (!env.FLUXA_KV) return null;
  const raw = await env.FLUXA_KV.get(CATALOG_KEY);
  if (!raw) return null;
  try {
    const x = JSON.parse(raw) as NodeCatalog;
    return x?.schemaVersion === 1 && Array.isArray(x.nodes) && Array.isArray(x.sourceHealth) ? x : null;
  } catch { return null; }
}

export async function saveNodeCatalog(env: Env, catalog: NodeCatalog): Promise<void> {
  if (!env.FLUXA_KV) return;
  await env.FLUXA_KV.put(CATALOG_KEY, JSON.stringify(catalog));
}

export function catalogConfigFingerprint(config: FluxaConfig): string {
  const text = JSON.stringify(config);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function catalogMatchesConfig(catalog: NodeCatalog | null, config: FluxaConfig): boolean {
  return !!catalog?.configFingerprint && catalog.configFingerprint === catalogConfigFingerprint(config);
}

export function isCatalogFresh(catalog: NodeCatalog | null, config: FluxaConfig, now = Date.now()): boolean {
  if (!catalog || !catalogMatchesConfig(catalog, config)) return false;
  const generated = Date.parse(catalog.generatedAt);
  return Number.isFinite(generated) && now - generated <= config.quality.catalogMaxAgeMinutes * 60_000;
}

export async function refreshNodeCatalog(config: FluxaConfig, previous: NodeCatalog | null = null): Promise<NodeCatalog> {
  const now = new Date();
  const nowIso = now.toISOString();
  const evidence = new Map<string, Evidence>();
  const previousHealth = new Map((previous?.sourceHealth ?? []).map((x) => [x.url, x]));

  // Official CIDR discovery and opt-in source fetching are independent network work.
  // Run them concurrently so a cold coordinated refresh does not add their worst-case
  // timeouts serially. Source filtering still waits for the validated CIDR result.
  const cidrPromise = fetchCloudflareIpv4Cidrs().catch(() => [] as string[]);
  const snapshotsPromise = mapWithConcurrency(config.sourceUrls, 4, (url) =>
    fetchSourceSnapshot(url, config.quality.sourceTimeoutMs, config.quality.sourceAddressLimit)
  );
  const [cidrs, snapshots] = await Promise.all([cidrPromise, snapshotsPromise]);

  for (const address of config.edgeAddresses) {
    const clean = normalizeAddress(address);
    if (isValidPublicHostname(clean)) addEvidence(evidence, clean, "manual", undefined, isIpv4InCidrs(clean, cidrs));
  }
  for (const ip of sampleIpv4Stable(cidrs, config.officialIpCount)) addEvidence(evidence, ip, "official", undefined, true);

  const sourceHealth: SourceHealth[] = [];

  for (const snapshot of snapshots) {
    let accepted = 0;
    if (snapshot.ok) {
      for (const rawAddress of snapshot.parsedAddresses) {
        const address = normalizeAddress(rawAddress);
        const ipv4 = isIpv4(address);
        const cfIpv4 = ipv4 && cidrs.length > 0 && isIpv4InCidrs(address, cidrs);
        if (ipv4 && config.quality.thirdPartyIpv4MustBeCloudflare && cidrs.length > 0 && !cfIpv4) continue;
        addEvidence(evidence, address, "source", snapshot.url, cfIpv4);
        accepted++;
      }
    }
    sourceHealth.push(updateSourceHealth(previousHealth.get(snapshot.url), snapshot, accepted, nowIso));
  }

  const healthByUrl = new Map(sourceHealth.map((x) => [x.url, x]));
  const previousNodes = new Map((previous?.nodes ?? []).map((x) => [x.address, x]));
  const nodes: NodeCandidate[] = [];

  for (const item of evidence.values()) {
    const prev = previousNodes.get(item.address);
    const score = calculateFluxScore(item, healthByUrl, 0, config);
    nodes.push({
      address: item.address,
      origins: [...item.origins].sort(),
      sources: [...item.sources].sort(),
      firstSeenAt: prev?.firstSeenAt ?? nowIso,
      lastSeenAt: nowIso,
      misses: 0,
      cloudflareIpv4: item.cloudflareIpv4,
      fluxScore: score,
      status: statusFor(score, 0, config),
      reasons: scoreReasons(item, healthByUrl)
    });
  }

  for (const prev of previous?.nodes ?? []) {
    if (evidence.has(prev.address)) continue;
    if (prev.origins.includes("worker")) continue; // purge host-specific candidates persisted by pre-v0.7 catalogs
    const misses = prev.misses + 1;
    const score = Math.max(0, prev.fluxScore - 18);
    nodes.push({ ...prev, misses, fluxScore: score, status: statusFor(score, misses, config), reasons: [...prev.reasons.filter((x) => !x.startsWith("missed refresh")), `missed refresh x${misses}`] });
  }

  nodes.sort((a, b) => b.fluxScore - a.fluxScore || a.address.localeCompare(b.address));
  return {
    schemaVersion: 1,
    generatedAt: nowIso,
    configFingerprint: catalogConfigFingerprint(config),
    sourceHealth: sourceHealth.sort((a, b) => b.reputationScore - a.reputationScore || a.url.localeCompare(b.url)),
    nodes,
    summary: summarize(nodes, config)
  };
}

export function selectSubscriptionAddresses(workerHost: string, catalog: NodeCatalog | null, config: FluxaConfig): string[] {
  const out = new Set<string>();
  if (workerHost && isValidPublicHostname(workerHost)) out.add(workerHost);
  const nodes = [...(catalog?.nodes ?? [])].sort((a, b) => b.fluxScore - a.fluxScore);
  for (const node of nodes) {
    // v0.7+ never persists request-specific Worker hostnames. Skip any legacy
    // host-specific candidates until the next catalog refresh purges them.
    if (node.origins.includes("worker")) continue;
    if (node.status === "retired" || node.misses > config.quality.maxMisses || node.fluxScore < config.quality.minFluxScore) continue;
    out.add(node.address);
    if (out.size >= config.maxSubscriptionNodes) break;
  }
  return [...out].slice(0, config.maxSubscriptionNodes);
}

export function calculateSourceReputation(attempts: number, successes: number, consecutiveFailures: number, currentOk: boolean, parsedItems: number, acceptedItems: number): number {
  const smoothedSuccess = (successes + 2) / (attempts + 4);
  const acceptance = parsedItems > 0 ? Math.min(1, acceptedItems / parsedItems) : 0;
  const score = 25 + 45 * smoothedSuccess + (currentOk ? 10 : 0) + 10 * acceptance - Math.min(30, consecutiveFailures * 10);
  return clamp(Math.round(score), 0, 100);
}

export function gradeFor(score: number): SourceHealth["grade"] {
  return score >= 85 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 45 ? "D" : "F";
}

function updateSourceHealth(previous: SourceHealth | undefined, snapshot: SourceSnapshot, accepted: number, nowIso: string): SourceHealth {
  const attempts = (previous?.attempts ?? 0) + 1;
  const successes = (previous?.successes ?? 0) + (snapshot.ok ? 1 : 0);
  const consecutiveFailures = snapshot.ok ? 0 : (previous?.consecutiveFailures ?? 0) + 1;
  const reputationScore = calculateSourceReputation(attempts, successes, consecutiveFailures, snapshot.ok, snapshot.parsedAddresses.length, accepted);
  return {
    url: snapshot.url,
    attempts,
    successes,
    consecutiveFailures,
    ...(snapshot.ok ? { lastSuccessAt: nowIso } : previous?.lastSuccessAt ? { lastSuccessAt: previous.lastSuccessAt } : {}),
    ...(!snapshot.ok ? { lastError: snapshot.error ?? "source fetch failed" } : {}),
    lastDurationMs: snapshot.durationMs,
    lastRawItems: snapshot.rawItems,
    lastParsedItems: snapshot.parsedAddresses.length,
    lastAcceptedItems: accepted,
    reputationScore,
    grade: gradeFor(reputationScore)
  };
}

function calculateFluxScore(item: Evidence, health: Map<string, SourceHealth>, misses: number, config: FluxaConfig): number {
  if (item.origins.has("worker")) return 100;
  let score = 0;
  if (item.origins.has("manual")) score = Math.max(score, 95);
  if (item.origins.has("official")) score = Math.max(score, 82);
  if (item.origins.has("source")) {
    const reps = [...item.sources].map((url) => health.get(url)?.reputationScore ?? 50);
    const average = reps.length ? reps.reduce((a, b) => a + b, 0) / reps.length : 50;
    let sourceScore = 35 + average * 0.45;
    if (item.cloudflareIpv4) sourceScore += 10;
    sourceScore += Math.min(12, Math.max(0, item.sources.size - 1) * 4);
    sourceScore += 5;
    score = Math.max(score, sourceScore);
  }
  score -= misses * 18;
  return clamp(Math.round(score), 0, 100);
}

function scoreReasons(item: Evidence, health: Map<string, SourceHealth>): string[] {
  const reasons: string[] = [];
  if (item.origins.has("worker")) reasons.push("current Worker hostname");
  if (item.origins.has("manual")) reasons.push("manually trusted address");
  if (item.origins.has("official")) reasons.push("sampled from Cloudflare official IPv4 CIDR");
  if (item.origins.has("source")) reasons.push(`seen in ${item.sources.size} configured source${item.sources.size === 1 ? "" : "s"}`);
  if (item.cloudflareIpv4) reasons.push("IPv4 verified inside Cloudflare official CIDR");
  if (item.sources.size) {
    const avg = Math.round([...item.sources].reduce((sum, url) => sum + (health.get(url)?.reputationScore ?? 50), 0) / item.sources.size);
    reasons.push(`source reputation avg ${avg}`);
  }
  return reasons;
}

function statusFor(score: number, misses: number, config: FluxaConfig): NodeStatus {
  if (misses > config.quality.maxMisses) return "retired";
  if (score >= 85) return "recommended";
  if (score >= config.quality.minFluxScore) return "healthy";
  if (score >= Math.max(30, config.quality.minFluxScore - 20)) return "probation";
  return "quarantined";
}

function summarize(nodes: NodeCandidate[], config: FluxaConfig): NodeCatalog["summary"] {
  const summary = { total: nodes.length, eligible: 0, recommended: 0, healthy: 0, probation: 0, quarantined: 0, retired: 0 };
  for (const node of nodes) {
    summary[node.status]++;
    if (node.status !== "retired" && node.fluxScore >= config.quality.minFluxScore) summary.eligible++;
  }
  return summary;
}

function addEvidence(map: Map<string, Evidence>, address: string, origin: NodeOrigin, source?: string, cloudflareIpv4 = false): void {
  const clean = normalizeAddress(address);
  if (!isValidPublicHostname(clean)) return;
  const existing = map.get(clean) ?? { address: clean, origins: new Set<NodeOrigin>(), sources: new Set<string>(), cloudflareIpv4: false };
  existing.origins.add(origin);
  if (source) existing.sources.add(source);
  existing.cloudflareIpv4 ||= cloudflareIpv4;
  map.set(clean, existing);
}

function normalizeAddress(value: string): string { return value.trim().toLowerCase().replace(/^\[|\]$/g, ""); }
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
