import { VERSION } from "./constants.js";
import { catalogMatchesConfig, isCatalogFresh } from "./catalog.js";
import type { Env, FluxaConfig, NodeCatalog } from "./types.js";

export interface DiagnosticCheck {
  id: string;
  ok: boolean;
  level: "ok" | "warn" | "error";
  message: string;
}

export function buildDiagnostics(env: Env, cfg: FluxaConfig, catalog: NodeCatalog | null): { ok: boolean; version: string; checks: DiagnosticCheck[] } {
  const checks: DiagnosticCheck[] = [];
  checks.push(check("kv", !!env.FLUXA_KV, env.FLUXA_KV ? "KV persistence is bound (eventually consistent across Cloudflare locations)" : "FLUXA_KV is not bound; catalog/config persistence is disabled", env.FLUXA_KV ? "ok" : "warn"));
  checks.push(check("coordinator", !!env.FLUXA_COORDINATOR, env.FLUXA_COORDINATOR ? "Global Fluxa control-plane coordination is bound through a Durable Object" : "FLUXA_COORDINATOR is not bound; config/history/audit use legacy KV writers and refresh coalescing is isolate-local only", env.FLUXA_COORDINATOR ? "ok" : "warn"));
  checks.push(check("protocol", cfg.protocols.vless || cfg.protocols.trojan, "At least one proxy protocol is enabled", cfg.protocols.vless || cfg.protocols.trojan ? "ok" : "error"));
  checks.push(check("paths", cfg.paths.vless !== cfg.paths.trojan, "VLESS and Trojan paths are distinct", cfg.paths.vless !== cfg.paths.trojan ? "ok" : "error"));
  checks.push(check("secrets", env.ADMIN_TOKEN !== env.SUB_TOKEN && env.CLIENT_UUID !== env.SUB_TOKEN, "Administrative, subscription, and protocol credentials are separated", env.ADMIN_TOKEN !== env.SUB_TOKEN && env.CLIENT_UUID !== env.SUB_TOKEN ? "ok" : "error"));
  checks.push(check("catalog", !!catalog, catalog ? `Catalog contains ${catalog.summary.total} nodes` : "No persisted quality catalog yet", catalog ? "ok" : "warn"));
  if (catalog) checks.push(check("config-match", catalogMatchesConfig(catalog, cfg), catalogMatchesConfig(catalog, cfg) ? "Catalog was generated from the current configuration" : "Catalog configuration fingerprint is stale; the next request will rebuild it, with Worker-host-only fallback if refresh fails", catalogMatchesConfig(catalog, cfg) ? "ok" : "warn"));
  if (catalog) checks.push(check("freshness", isCatalogFresh(catalog, cfg), isCatalogFresh(catalog, cfg) ? "Catalog is fresh" : "Catalog is stale and will refresh", isCatalogFresh(catalog, cfg) ? "ok" : "warn"));
  if (catalog) checks.push(check("eligible", catalog.summary.eligible > 0, `${catalog.summary.eligible} nodes are eligible for subscriptions`, catalog.summary.eligible > 0 ? "ok" : "error"));
  const failingSources = catalog?.sourceHealth.filter((x) => x.grade === "F" || x.consecutiveFailures >= 3).length ?? 0;
  checks.push(check("sources", failingSources === 0, failingSources ? `${failingSources} source(s) are failing or grade F` : "No severely failing sources", failingSources === 0 ? "ok" : "warn"));
  const hasError = checks.some((x) => x.level === "error" && !x.ok);
  return { ok: !hasError, version: VERSION, checks };
}

function check(id: string, ok: boolean, message: string, level: DiagnosticCheck["level"]): DiagnosticCheck {
  return { id, ok, level: ok && level !== "warn" ? "ok" : level, message };
}
