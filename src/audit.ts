import { AUDIT_KEY } from "./constants.js";
import type { AuditEvent, Env } from "./types.js";

const MAX_EVENTS = 50;

export async function loadAuditLog(env: Env): Promise<AuditEvent[]> {
  if (!env.FLUXA_KV) return [];
  const raw = await env.FLUXA_KV.get(AUDIT_KEY);
  if (!raw) return [];
  try {
    const items = JSON.parse(raw) as AuditEvent[];
    return Array.isArray(items) ? items.filter(validAuditEvent).slice(0, MAX_EVENTS) : [];
  } catch { return []; }
}

export async function appendAuditEvent(env: Env, action: AuditEvent["action"], detail?: string): Promise<void> {
  if (!env.FLUXA_KV) return;
  const previous = await loadAuditLog(env);
  const next: AuditEvent = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    action,
    ...(detail ? { detail: sanitizeDetail(detail) } : {})
  };
  await env.FLUXA_KV.put(AUDIT_KEY, JSON.stringify([next, ...previous].slice(0, MAX_EVENTS)));
}

function validAuditEvent(value: unknown): value is AuditEvent {
  if (!value || typeof value !== "object") return false;
  const x = value as Partial<AuditEvent>;
  return typeof x.id === "string" && typeof x.at === "string" && typeof x.action === "string";
}

function sanitizeDetail(value: string): string {
  return value.replace(/[\r\n\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
}
