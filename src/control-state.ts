import { validateConfig } from "./config.js";
import type { AuditEvent, FluxaConfig } from "./types.js";

export interface ConfigRevision {
  id: string;
  at: string;
  reason: "pre-update" | "pre-rollback";
  config: FluxaConfig;
}

export interface ControlState {
  schemaVersion: 1;
  revision: number;
  config: FluxaConfig;
  history: ConfigRevision[];
  audit: AuditEvent[];
}

export const MAX_CONFIG_REVISIONS = 8;
export const MAX_AUDIT_EVENTS = 50;

export class ControlRevisionConflict extends Error {
  readonly currentRevision: number;
  constructor(currentRevision: number) {
    super("configuration changed; reload before saving");
    this.name = "ControlRevisionConflict";
    this.currentRevision = currentRevision;
  }
}

export function createControlState(config: FluxaConfig, history: ConfigRevision[] = [], audit: AuditEvent[] = []): ControlState {
  return {
    schemaVersion: 1,
    revision: 1,
    config: structuredClone(validateConfig(config)),
    history: sanitizeHistory(history).slice(0, MAX_CONFIG_REVISIONS),
    audit: sanitizeAudit(audit).slice(0, MAX_AUDIT_EVENTS)
  };
}

export function updateControlConfig(state: ControlState, input: unknown, expectedRevision: number): ControlState {
  assertRevision(state, expectedRevision);
  const nextConfig = validateConfig(input);
  const nextHistory = prependSnapshot(state.history, state.config, "pre-update");
  return {
    ...state,
    revision: state.revision + 1,
    config: nextConfig,
    history: nextHistory,
    audit: prependAudit(state.audit, "config.update", "configuration updated from admin API")
  };
}

export function rollbackControlConfig(state: ControlState, id: string, expectedRevision: number): { state: ControlState; revision: ConfigRevision } {
  assertRevision(state, expectedRevision);
  if (!/^[a-zA-Z0-9._-]{8,96}$/.test(id)) throw new Error("configuration revision not found");
  const target = state.history.find((item) => item.id === id);
  if (!target) throw new Error("configuration revision not found");
  const nextHistory = prependSnapshot(state.history, state.config, "pre-rollback");
  const nextState: ControlState = {
    ...state,
    revision: state.revision + 1,
    config: structuredClone(validateConfig(target.config)),
    history: nextHistory,
    audit: prependAudit(state.audit, "config.rollback", `rolled back to revision ${target.id}`)
  };
  return { state: nextState, revision: target };
}

export function appendControlAudit(state: ControlState, action: AuditEvent["action"], detail?: string): ControlState {
  return { ...state, audit: prependAudit(state.audit, action, detail) };
}

export function configRevisionEtag(revision: number): string {
  return `"fluxa-config-${Math.max(1, Math.trunc(revision))}"`;
}

export function parseConfigRevisionEtag(value: string | null): number | null {
  const match = String(value ?? "").trim().match(/^(?:W\/)?"fluxa-config-(\d+)"$/);
  if (!match) return null;
  const revision = Number(match[1]);
  return Number.isSafeInteger(revision) && revision >= 1 ? revision : null;
}

function assertRevision(state: ControlState, expectedRevision: number): void {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || expectedRevision !== state.revision) {
    throw new ControlRevisionConflict(state.revision);
  }
}

function prependSnapshot(history: ConfigRevision[], config: FluxaConfig, reason: ConfigRevision["reason"]): ConfigRevision[] {
  const serialized = JSON.stringify(config);
  if (history[0] && JSON.stringify(history[0].config) === serialized) return history.slice(0, MAX_CONFIG_REVISIONS);
  const revision: ConfigRevision = { id: revisionId(), at: new Date().toISOString(), reason, config: structuredClone(config) };
  return [revision, ...history].slice(0, MAX_CONFIG_REVISIONS);
}

function prependAudit(events: AuditEvent[], action: AuditEvent["action"], detail?: string): AuditEvent[] {
  const event: AuditEvent = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    action,
    ...(detail ? { detail: sanitizeDetail(detail) } : {})
  };
  return [event, ...events].slice(0, MAX_AUDIT_EVENTS);
}

function sanitizeHistory(history: ConfigRevision[]): ConfigRevision[] {
  const result: ConfigRevision[] = [];
  for (const item of history) {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || typeof item.at !== "string") continue;
    if (item.reason !== "pre-update" && item.reason !== "pre-rollback") continue;
    try { result.push({ id: item.id, at: item.at, reason: item.reason, config: validateConfig(item.config) }); } catch { /* ignore legacy corruption */ }
  }
  return result;
}

function sanitizeAudit(events: AuditEvent[]): AuditEvent[] {
  return events.filter((item) => !!item && typeof item.id === "string" && typeof item.at === "string" && typeof item.action === "string")
    .map((item) => ({ ...item, ...(item.detail ? { detail: sanitizeDetail(item.detail) } : {}) }));
}

function sanitizeDetail(value: string): string {
  return value.replace(/[\r\n\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
}

function revisionId(): string {
  const random = crypto.getRandomValues(new Uint32Array(2));
  return `${Date.now().toString(36)}-${random[0].toString(36)}${random[1].toString(36)}`;
}
