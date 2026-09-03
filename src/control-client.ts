import { withTimeout } from "./async-utils.js";
import { configRevisionEtag, parseConfigRevisionEtag, type ConfigRevision } from "./control-state.js";
import type { AuditEvent, Env, FluxaConfig } from "./types.js";

const CONTROL_TIMEOUT_MS = 10_000;

export interface AuthoritativeConfig {
  config: FluxaConfig;
  revision: number;
  etag: string;
}

export async function getAuthoritativeConfig(env: Env): Promise<AuthoritativeConfig> {
  const data = await requestCoordinator(env, "/config/get", { method: "POST" });
  return parseConfigPayload(data);
}

export async function updateConfigViaCoordinator(env: Env, input: unknown, ifMatch: string | null): Promise<AuthoritativeConfig> {
  const expectedRevision = parseConfigRevisionEtag(ifMatch);
  if (expectedRevision === null) throw new PreconditionRequiredError();
  const data = await requestCoordinator(env, "/config/update", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedRevision, input })
  });
  return parseConfigPayload(data);
}

export async function rollbackConfigViaCoordinator(env: Env, id: string, ifMatch: string | null): Promise<{ config: FluxaConfig; revision: number; etag: string; restoredRevision: ConfigRevision }> {
  const expectedRevision = parseConfigRevisionEtag(ifMatch);
  if (expectedRevision === null) throw new PreconditionRequiredError();
  const data = await requestCoordinator(env, "/config/rollback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedRevision, id })
  });
  const base = parseConfigPayload(data);
  const restoredRevision = objectField(data, "restoredRevision") as ConfigRevision;
  return { ...base, restoredRevision };
}

export async function getConfigHistoryViaCoordinator(env: Env): Promise<ConfigRevision[]> {
  const data = await requestCoordinator(env, "/config/history", { method: "POST" });
  const value = objectField(data, "revisions");
  return Array.isArray(value) ? value as ConfigRevision[] : [];
}

export async function getAuditViaCoordinator(env: Env): Promise<AuditEvent[]> {
  const data = await requestCoordinator(env, "/audit/get", { method: "POST" });
  const value = objectField(data, "events");
  return Array.isArray(value) ? value as AuditEvent[] : [];
}

export async function appendAuditViaCoordinator(env: Env, action: AuditEvent["action"], detail?: string): Promise<void> {
  await requestCoordinator(env, "/audit/append", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, detail })
  });
}

export class PreconditionRequiredError extends Error {
  constructor() { super("If-Match with the current Fluxa config ETag is required"); this.name = "PreconditionRequiredError"; }
}

export class ControlConflictError extends Error {
  readonly currentRevision: number | null;
  constructor(message: string, currentRevision: number | null) { super(message); this.name = "ControlConflictError"; this.currentRevision = currentRevision; }
}

function parseConfigPayload(data: unknown): AuthoritativeConfig {
  const config = objectField(data, "config") as FluxaConfig;
  const revision = Number(objectField(data, "revision"));
  if (!config || !Number.isSafeInteger(revision) || revision < 1) throw new Error("control plane returned an invalid config payload");
  return { config, revision, etag: configRevisionEtag(revision) };
}

async function requestCoordinator(env: Env, path: string, init: RequestInit): Promise<unknown> {
  if (!env.FLUXA_COORDINATOR) throw new Error("FLUXA_COORDINATOR Durable Object binding is not configured");
  const stub = env.FLUXA_COORDINATOR.get(env.FLUXA_COORDINATOR.idFromName("catalog"));
  const response = await withTimeout(stub.fetch(`https://fluxa.internal${path}`, init), CONTROL_TIMEOUT_MS, "Fluxa control plane timed out");
  const text = await response.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error(`Fluxa control plane returned invalid JSON (${response.status})`); }
  if (!response.ok) {
    const error = String(objectField(data, "error") ?? `Fluxa control plane failed (${response.status})`);
    const currentRevision = Number(objectField(data, "currentRevision"));
    if (response.status === 409 || response.status === 412) throw new ControlConflictError(error, Number.isSafeInteger(currentRevision) ? currentRevision : null);
    throw new Error(error);
  }
  return data;
}

function objectField(value: unknown, key: string): unknown {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined;
}
