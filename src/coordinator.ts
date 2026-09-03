import { DurableObject } from "cloudflare:workers";
import { createSingleFlight } from "./async-utils.js";
import { catalogConfigFingerprint, loadNodeCatalog, refreshNodeCatalog, saveNodeCatalog } from "./catalog.js";
import { loadConfig, saveConfig, validateConfig } from "./config.js";
import { loadConfigHistory } from "./config-history.js";
import { loadAuditLog } from "./audit.js";
import {
  appendControlAudit,
  ControlRevisionConflict,
  createControlState,
  rollbackControlConfig,
  updateControlConfig,
  type ControlState
} from "./control-state.js";
import type { AuditEvent, Env, FluxaConfig, NodeCatalog } from "./types.js";

interface RefreshRequestBody { config?: unknown; }
interface UpdateRequestBody { expectedRevision?: unknown; input?: unknown; }
interface RollbackRequestBody { expectedRevision?: unknown; id?: unknown; }
interface AuditRequestBody { action?: unknown; detail?: unknown; }

const CONTROL_STATE_KEY = "control:v1";

/**
 * Global control-plane coordinator.
 *
 * Ordinary VLESS/Trojan traffic never crosses this Durable Object. It only
 * serializes low-frequency control-plane mutations and catalog commits.
 * External catalog discovery runs outside the mutation queue, then performs an
 * optimistic revision check immediately before committing the refreshed catalog.
 */
export class FluxaCoordinator extends DurableObject<Env> {
  private readonly refreshFlights = createSingleFlight<string, NodeCatalog>();
  private mutationTail: Promise<void> = Promise.resolve();
  private controlInit?: Promise<ControlState>;

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (!this.env.FLUXA_KV) return json({ ok: false, error: "FLUXA_KV is required for the Fluxa control plane" }, 503);

    try {
      if (request.method === "POST" && url.pathname === "/refresh") return await this.handleRefresh(request);
      if (request.method === "POST" && url.pathname === "/config/get") {
        const state = await this.ensureControlState();
        return json({ ok: true, config: state.config, revision: state.revision });
      }
      if (request.method === "POST" && url.pathname === "/config/update") return await this.handleConfigUpdate(request);
      if (request.method === "POST" && url.pathname === "/config/rollback") return await this.handleConfigRollback(request);
      if (request.method === "POST" && url.pathname === "/config/history") {
        const state = await this.ensureControlState();
        return json({ ok: true, revisions: state.history, revision: state.revision });
      }
      if (request.method === "POST" && url.pathname === "/audit/get") {
        const state = await this.ensureControlState();
        return json({ ok: true, events: state.audit });
      }
      if (request.method === "POST" && url.pathname === "/audit/append") return await this.handleAuditAppend(request);
      return json({ ok: false, error: "not found" }, 404);
    } catch (error) {
      if (error instanceof ControlRevisionConflict) {
        return json({ ok: false, error: error.message, currentRevision: error.currentRevision }, 412);
      }
      if (error instanceof StaleCatalogRefresh) {
        return json({ ok: false, error: error.message, currentRevision: error.currentRevision }, 409);
      }
      return json({ ok: false, error: error instanceof Error ? error.message : "control plane operation failed" }, 502);
    }
  }

  private async handleRefresh(request: Request): Promise<Response> {
    const body = await readBody<RefreshRequestBody>(request, 64 * 1024);
    const config = validateConfig(body.config);
    const incomingFingerprint = catalogConfigFingerprint(config);
    const initialState = await this.ensureControlState();
    this.assertActiveConfig(initialState, incomingFingerprint);

    const catalog = await this.refreshFlights(incomingFingerprint, async () => {
      // Do slow external discovery without blocking config mutations.
      const before = await this.ensureControlState();
      this.assertActiveConfig(before, incomingFingerprint);
      const previous = await loadNodeCatalog(this.env);
      const next = await refreshNodeCatalog(config, previous);

      // Commit through the same mutation queue as config writes. A config update
      // that completed while discovery was in flight makes this refresh stale.
      return this.enqueueMutation(async () => {
        const current = await this.ensureControlState();
        this.assertActiveConfig(current, incomingFingerprint);
        await saveNodeCatalog(this.env, next);
        return next;
      });
    });

    return json({ ok: true, catalog });
  }

  private async handleConfigUpdate(request: Request): Promise<Response> {
    const body = await readBody<UpdateRequestBody>(request, 64 * 1024);
    const expectedRevision = Number(body.expectedRevision);
    return this.enqueueMutation(async () => {
      const current = await this.ensureControlState();
      const next = updateControlConfig(current, body.input, expectedRevision);
      await this.persistConfigState(current, next);
      return json({ ok: true, config: next.config, revision: next.revision });
    });
  }

  private async handleConfigRollback(request: Request): Promise<Response> {
    const body = await readBody<RollbackRequestBody>(request, 8 * 1024);
    const expectedRevision = Number(body.expectedRevision);
    const id = typeof body.id === "string" ? body.id : "";
    return this.enqueueMutation(async () => {
      const current = await this.ensureControlState();
      const result = rollbackControlConfig(current, id, expectedRevision);
      await this.persistConfigState(current, result.state);
      return json({ ok: true, config: result.state.config, revision: result.state.revision, restoredRevision: result.revision });
    });
  }

  private async handleAuditAppend(request: Request): Promise<Response> {
    const body = await readBody<AuditRequestBody>(request, 8 * 1024);
    const action = body.action;
    if (!isAuditAction(action)) throw new Error("invalid audit action");
    const detail = typeof body.detail === "string" ? body.detail : undefined;
    return this.enqueueMutation(async () => {
      const current = await this.ensureControlState();
      const next = appendControlAudit(current, action, detail);
      await this.ctx.storage.put(CONTROL_STATE_KEY, next);
      this.controlInit = Promise.resolve(next);
      return json({ ok: true });
    });
  }

  private ensureControlState(): Promise<ControlState> {
    if (this.controlInit) return this.controlInit;
    const promise = (async () => {
      const existing = await this.ctx.storage.get<ControlState>(CONTROL_STATE_KEY);
      if (existing?.schemaVersion === 1 && Number.isSafeInteger(existing.revision) && existing.revision >= 1) return existing;

      // One-time migration from the pre-v0.8 KV control-plane representation.
      const [config, history, audit] = await Promise.all([
        loadConfig(this.env),
        loadConfigHistory(this.env),
        loadAuditLog(this.env)
      ]);
      const initial = createControlState(config, history, audit);
      await this.ctx.storage.put(CONTROL_STATE_KEY, initial);
      return initial;
    })();
    this.controlInit = promise.catch((error) => { this.controlInit = undefined; throw error; });
    return this.controlInit;
  }

  private enqueueMutation<T>(task: () => Promise<T>): Promise<T> {
    const run = this.mutationTail.then(task, task);
    this.mutationTail = run.then(() => undefined, () => undefined);
    return run;
  }

  private assertActiveConfig(state: ControlState, incomingFingerprint: string): void {
    if (catalogConfigFingerprint(state.config) !== incomingFingerprint) throw new StaleCatalogRefresh(state.revision);
  }

  private async persistConfigState(previous: ControlState, next: ControlState): Promise<void> {
    // KV remains the edge-readable cache, but the DO is the authoritative writer.
    // If the strong state write unexpectedly fails after KV succeeds, best-effort
    // restore the previous KV value so the two representations do not drift.
    await saveConfig(this.env, next.config);
    try {
      await this.ctx.storage.put(CONTROL_STATE_KEY, next);
      this.controlInit = Promise.resolve(next);
    } catch (error) {
      try { await saveConfig(this.env, previous.config); } catch { /* best effort rollback */ }
      throw error;
    }
  }
}

class StaleCatalogRefresh extends Error {
  readonly currentRevision: number;
  constructor(currentRevision: number) {
    super("catalog refresh is stale because configuration changed");
    this.name = "StaleCatalogRefresh";
    this.currentRevision = currentRevision;
  }
}

async function readBody<T>(request: Request, maxBytes: number): Promise<T> {
  const text = await request.text();
  if (text.length > maxBytes) throw new Error("control plane request is too large");
  let parsed: unknown;
  try { parsed = JSON.parse(text || "{}"); }
  catch { throw new Error("control plane request is not valid JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("control plane request must be an object");
  return parsed as T;
}

function isAuditAction(value: unknown): value is AuditEvent["action"] {
  return value === "config.update" || value === "config.rollback" || value === "catalog.refresh" || value === "catalog.refresh.failed";
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
