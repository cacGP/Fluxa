import { CONFIG_HISTORY_KEY } from "./constants.js";
import type { Env, FluxaConfig } from "./types.js";

export interface ConfigRevision {
  id: string;
  at: string;
  reason: "pre-update" | "pre-rollback";
  config: FluxaConfig;
}

const MAX_REVISIONS = 8;

export async function loadConfigHistory(env: Env): Promise<ConfigRevision[]> {
  if (!env.FLUXA_KV) return [];
  const raw = await env.FLUXA_KV.get(CONFIG_HISTORY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isConfigRevision).slice(0, MAX_REVISIONS);
  } catch { return []; }
}

export async function snapshotConfig(env: Env, config: FluxaConfig, reason: ConfigRevision["reason"]): Promise<ConfigRevision | null> {
  if (!env.FLUXA_KV) return null;
  const history = await loadConfigHistory(env);
  const serialized = JSON.stringify(config);
  if (history[0] && JSON.stringify(history[0].config) === serialized) return history[0];
  const revision: ConfigRevision = {
    id: revisionId(),
    at: new Date().toISOString(),
    reason,
    config: structuredClone(config)
  };
  await env.FLUXA_KV.put(CONFIG_HISTORY_KEY, JSON.stringify([revision, ...history].slice(0, MAX_REVISIONS)));
  return revision;
}

export async function findConfigRevision(env: Env, id: string): Promise<ConfigRevision | null> {
  if (!/^[a-zA-Z0-9._-]{8,96}$/.test(id)) return null;
  return (await loadConfigHistory(env)).find((x) => x.id === id) ?? null;
}

function isConfigRevision(value: unknown): value is ConfigRevision {
  if (!value || typeof value !== "object") return false;
  const x = value as Partial<ConfigRevision>;
  return typeof x.id === "string" && typeof x.at === "string" && (x.reason === "pre-update" || x.reason === "pre-rollback") && !!x.config && typeof x.config === "object";
}

function revisionId(): string {
  const random = crypto.getRandomValues(new Uint32Array(2));
  return `${Date.now().toString(36)}-${random[0].toString(36)}${random[1].toString(36)}`;
}
