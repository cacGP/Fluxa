import { VERSION } from "./constants.js";
import { loadConfig, saveConfig } from "./config.js";
import { adminHtml } from "./admin-ui.js";
import { readJsonLimited, safeDecodePathComponent, randomCspNonce } from "./http-utils.js";
import { catalogMatchesConfig, isCatalogFresh, loadNodeCatalog, refreshNodeCatalog, saveNodeCatalog, selectSubscriptionAddresses } from "./catalog.js";
import { isAdmin, constantTimeEqual, validUuid } from "./security.js";
import { generateSubscription, normalizeSubscriptionFormat, SUPPORTED_FORMATS } from "./subscriptions.js";
import { subscriptionResponse } from "./subscription-response.js";
import { upgradeProxy, MAX_WS_FRAME_BYTES, PROXY_HANDSHAKE_TIMEOUT_MS } from "./proxy/session.js";
import { appendAuditEvent, loadAuditLog } from "./audit.js";
import { appendAuditViaCoordinator, ControlConflictError, getAuditViaCoordinator, getAuthoritativeConfig, getConfigHistoryViaCoordinator, PreconditionRequiredError, rollbackConfigViaCoordinator, updateConfigViaCoordinator } from "./control-client.js";
import { buildDiagnostics } from "./diagnostics.js";
import { findConfigRevision, loadConfigHistory, snapshotConfig } from "./config-history.js";
import type { Env, NodeCatalog } from "./types.js";
import { createSingleFlight } from "./async-utils.js";
import { refreshViaCoordinator } from "./coordinator-client.js";
export { FluxaCoordinator } from "./coordinator.js";

const refreshSingleFlight = createSingleFlight<string, NodeCatalog>();
const backgroundRetryAfter = new Map<string, number>();
const BACKGROUND_REFRESH_RETRY_MS = 60_000;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const configError = validateSecrets(env);
    if (configError) return json({ ok:false, error:configError }, 500);
    const cfg = await loadConfig(env);

    if (url.pathname === "/health") {
      const catalog = await loadNodeCatalog(env);
      return json({
        ok:true, name:"Fluxa", version:VERSION, kv:!!env.FLUXA_KV, protocols:cfg.protocols,
        catalog: catalog ? { generatedAt:catalog.generatedAt, fresh:isCatalogFresh(catalog,cfg), ...catalog.summary } : null
      });
    }

    if (url.pathname === "/api/capabilities" && request.method === "GET") {
      return json({
        ok:true,
        name:"Fluxa",
        version:VERSION,
        protocols:{ ...cfg.protocols, transport:"websocket", tlsRequired:true, udp:false },
        subscriptionFormats:[...SUPPORTED_FORMATS],
        aliases:{ mihomo:"clash", v2rayn:"raw", v2rayng:"raw", shadowrocket:"raw", auto:"user-agent detection" },
        compatibility:{ clash:"VLESS + Trojan", singbox:"VLESS + Trojan", loon:"VLESS + Trojan", surge:"Trojan only", raw:"URI bundle" },
        reliability:{ serializedWebSocketIngress:true, tcpConnectTimeoutMs:10000, proxyHandshakeTimeoutMs:PROXY_HANDSHAKE_TIMEOUT_MS, maxWebSocketFrameBytes:MAX_WS_FRAME_BYTES, configRollback:!!env.FLUXA_KV, cloudflareIpv6Detection:true, upstreamDnsPinning:true, boundedAdminJsonBytes:65536, refreshSingleFlight:true, globalRefreshCoordinator:!!env.FLUXA_COORDINATOR, controlPlaneConsistency:!!env.FLUXA_COORDINATOR, optimisticConfigWrites:!!env.FLUXA_COORDINATOR, staleCatalogCommitGuard:!!env.FLUXA_COORDINATOR, hostIsolatedCatalog:true, staleIfRefreshError:true },
        security:{ protocolCredentialConstantTimeCompare:true, reservedProxyRoutes:true, cspNonce:true }
      });
    }

    if (url.pathname === "/") {
      const nonce = randomCspNonce();
      return new Response(homePage(nonce), { headers:securityHeaders("text/html; charset=utf-8", nonce, false) });
    }
    if (url.pathname === "/admin") {
      const nonce = randomCspNonce();
      return new Response(adminHtml(nonce), { headers:securityHeaders("text/html; charset=utf-8", nonce, true) });
    }

    if (url.pathname === "/api/nodes" && request.method === "GET") {
      if (!isAdmin(request, env.ADMIN_TOKEN)) return json({ok:false,error:"unauthorized"},401);
      const catalog = await catalogForRequest(env, cfg, ctx);
      return json({ ok:true, catalog, subscriptionAddresses:selectSubscriptionAddresses(url.hostname,catalog,cfg) });
    }

    if (url.pathname === "/api/nodes/refresh" && request.method === "POST") {
      if (!isAdmin(request, env.ADMIN_TOKEN)) return json({ok:false,error:"unauthorized"},401);
      try {
        const previous = await loadNodeCatalog(env);
        const refreshConfig = env.FLUXA_COORDINATOR ? (await getAuthoritativeConfig(env)).config : cfg;
        const catalog = await refreshCatalogAndSave(env, refreshConfig, previous);
        ctx.waitUntil(appendAudit(env, "catalog.refresh", `manual refresh: ${catalog.summary.eligible}/${catalog.summary.total} eligible`).catch(() => undefined));
        return json({ ok:true, catalog, subscriptionAddresses:selectSubscriptionAddresses(url.hostname,catalog,refreshConfig) });
      } catch (e) {
        ctx.waitUntil(appendAudit(env, "catalog.refresh.failed", e instanceof Error ? e.message : "catalog refresh failed").catch(() => undefined));
        return json({ok:false,error:e instanceof Error?e.message:"catalog refresh failed"},502);
      }
    }

    if (url.pathname === "/api/config") {
      if (!isAdmin(request, env.ADMIN_TOKEN)) return json({ok:false,error:"unauthorized"},401);
      if (request.method === "GET") {
        if (env.FLUXA_COORDINATOR) {
          try {
            const authoritative = await getAuthoritativeConfig(env);
            return json(authoritative.config, 200, { etag: authoritative.etag, "x-fluxa-config-revision": String(authoritative.revision) });
          } catch (e) { return json({ok:false,error:e instanceof Error?e.message:"control plane unavailable"},503); }
        }
        return json(cfg);
      }
      if (request.method === "PUT") {
        try {
          if (!env.FLUXA_KV) return json({ok:false,error:"FLUXA_KV is required to persist configuration"},503);
          const previous = await loadNodeCatalog(env);
          const input = await readJsonLimited(request, 64 * 1024);
          if (env.FLUXA_COORDINATOR) {
            const result = await updateConfigViaCoordinator(env, input, request.headers.get("if-match"));
            ctx.waitUntil(refreshCatalogAndSave(env, result.config, previous).catch(() => undefined));
            return json(result.config, 200, { etag: result.etag, "x-fluxa-config-revision": String(result.revision) });
          }
          await snapshotConfig(env, cfg, "pre-update");
          const saved = await saveConfig(env, input);
          ctx.waitUntil(appendAuditEvent(env, "config.update", "configuration updated from admin API").catch(() => undefined));
          ctx.waitUntil(refreshCatalogAndSave(env, saved, previous).catch(() => undefined));
          return json(saved);
        } catch (e) {
          if (e instanceof PreconditionRequiredError) return json({ok:false,error:e.message},428);
          if (e instanceof ControlConflictError) return json({ok:false,error:e.message,currentRevision:e.currentRevision},412);
          return json({ok:false,error:e instanceof Error?e.message:"invalid config"},400);
        }
      }
      return new Response("Method Not Allowed", { status:405 });
    }

    if (url.pathname === "/api/config/history" && request.method === "GET") {
      if (!isAdmin(request, env.ADMIN_TOKEN)) return json({ok:false,error:"unauthorized"},401);
      try {
        const revisions = env.FLUXA_COORDINATOR ? await getConfigHistoryViaCoordinator(env) : await loadConfigHistory(env);
        return json({ok:true,revisions:revisions.map((r)=>({id:r.id,at:r.at,reason:r.reason,config:r.config}))});
      } catch (e) { return json({ok:false,error:e instanceof Error?e.message:"history unavailable"},503); }
    }

    if (url.pathname === "/api/config/rollback" && request.method === "POST") {
      if (!isAdmin(request, env.ADMIN_TOKEN)) return json({ok:false,error:"unauthorized"},401);
      if (!env.FLUXA_KV) return json({ok:false,error:"FLUXA_KV is required for rollback"},503);
      try {
        const body = await readJsonLimited<{ id?: unknown }>(request, 4 * 1024);
        const id = typeof body?.id === "string" ? body.id : "";
        const previousCatalog = await loadNodeCatalog(env);
        if (env.FLUXA_COORDINATOR) {
          const result = await rollbackConfigViaCoordinator(env, id, request.headers.get("if-match"));
          ctx.waitUntil(refreshCatalogAndSave(env, result.config, previousCatalog).catch(() => undefined));
          return json({ok:true,restored:result.config,revision:{id:result.restoredRevision.id,at:result.restoredRevision.at,reason:result.restoredRevision.reason}},200,{etag:result.etag,"x-fluxa-config-revision":String(result.revision)});
        }
        const revision = await findConfigRevision(env, id);
        if (!revision) return json({ok:false,error:"configuration revision not found"},404);
        await snapshotConfig(env, cfg, "pre-rollback");
        const restored = await saveConfig(env, revision.config);
        ctx.waitUntil(appendAuditEvent(env, "config.rollback", `rolled back to revision ${revision.id}`).catch(() => undefined));
        ctx.waitUntil(refreshCatalogAndSave(env, restored, previousCatalog).catch(() => undefined));
        return json({ok:true,restored,revision:{id:revision.id,at:revision.at,reason:revision.reason}});
      } catch (e) {
        if (e instanceof PreconditionRequiredError) return json({ok:false,error:e.message},428);
        if (e instanceof ControlConflictError) return json({ok:false,error:e.message,currentRevision:e.currentRevision},412);
        return json({ok:false,error:e instanceof Error?e.message:"rollback failed"},400);
      }
    }

    if (url.pathname === "/api/audit" && request.method === "GET") {
      if (!isAdmin(request, env.ADMIN_TOKEN)) return json({ok:false,error:"unauthorized"},401);
      try { return json({ok:true, events:env.FLUXA_COORDINATOR ? await getAuditViaCoordinator(env) : await loadAuditLog(env)}); }
      catch (e) { return json({ok:false,error:e instanceof Error?e.message:"audit unavailable"},503); }
    }

    if (url.pathname === "/api/diagnostics" && request.method === "GET") {
      if (!isAdmin(request, env.ADMIN_TOKEN)) return json({ok:false,error:"unauthorized"},401);
      try {
        const diagnosticConfig = env.FLUXA_COORDINATOR ? (await getAuthoritativeConfig(env)).config : cfg;
        return json(buildDiagnostics(env, diagnosticConfig, await loadNodeCatalog(env)));
      } catch (e) { return json({ok:false,error:e instanceof Error?e.message:"diagnostics unavailable"},503); }
    }

    if (url.pathname.startsWith("/sub/") && (request.method === "GET" || request.method === "HEAD")) {
      const token = safeDecodePathComponent(url.pathname.slice(5));
      if (token === null || !constantTimeEqual(token, env.SUB_TOKEN)) return new Response("Not Found", { status:404, headers:securityHeaders("text/plain; charset=utf-8") });
      const format = normalizeSubscriptionFormat(url.searchParams.get("format"), request.headers.get("user-agent") ?? "");
      if (!format) return json({ok:false,error:"unsupported subscription format",supported:[...SUPPORTED_FORMATS]},400);
      const catalog = await catalogForRequest(env, cfg, ctx);
      const addresses = selectSubscriptionAddresses(url.hostname, catalog, cfg);
      const body = generateSubscription(format, url.hostname, addresses, cfg, env);
      return subscriptionResponse(request, format, body);
    }

    if (cfg.protocols.vless && url.pathname === cfg.paths.vless) return upgradeProxy(request, env, cfg, "vless");
    if (cfg.protocols.trojan && url.pathname === cfg.paths.trojan) return upgradeProxy(request, env, cfg, "trojan");
    return new Response("Not Found", { status:404, headers:securityHeaders("text/plain; charset=utf-8") });
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (!env.FLUXA_KV) return;
    const configError = validateSecrets(env);
    if (configError) return;
    const cfg = await loadConfig(env);
    const previous = await loadNodeCatalog(env);
    ctx.waitUntil(refreshCatalogAndSave(env, cfg, previous).then(() => undefined).catch(() => undefined));
  }
};

async function catalogForRequest(env: Env, cfg: Awaited<ReturnType<typeof loadConfig>>, ctx: ExecutionContext): Promise<NodeCatalog | null> {
  const previous = await loadNodeCatalog(env);
  if (!previous || !catalogMatchesConfig(previous, cfg)) {
    try { return await refreshCatalogAndSave(env, cfg, previous); }
    catch { return null; } // subscriptions can still fall back to the current Worker hostname
  }
  if (!isCatalogFresh(previous, cfg)) scheduleBackgroundCatalogRefresh(env, cfg, previous, ctx);
  return previous;
}

function refreshKey(cfg: Awaited<ReturnType<typeof loadConfig>>): string {
  return JSON.stringify(cfg);
}

function refreshCatalogAndSave(env: Env, cfg: Awaited<ReturnType<typeof loadConfig>>, previous: NodeCatalog | null): Promise<NodeCatalog> {
  const key = refreshKey(cfg);
  return refreshSingleFlight(key, async () => {
    if (env.FLUXA_COORDINATOR) {
      const catalog = await refreshViaCoordinator(env, cfg);
      backgroundRetryAfter.delete(key);
      return catalog;
    }
    // Compatibility fallback for dashboard/manual deployments without the DO binding.
    // Official wrangler.jsonc configures the Durable Object, so normal deployments use global coordination.
    const catalog = await refreshNodeCatalog(cfg, previous);
    await saveNodeCatalog(env, catalog);
    backgroundRetryAfter.delete(key);
    return catalog;
  });
}

function scheduleBackgroundCatalogRefresh(env: Env, cfg: Awaited<ReturnType<typeof loadConfig>>, previous: NodeCatalog, ctx: ExecutionContext): void {
  const key = refreshKey(cfg);
  if ((backgroundRetryAfter.get(key) ?? 0) > Date.now()) return;
  const task = refreshCatalogAndSave(env, cfg, previous).catch(() => {
    backgroundRetryAfter.set(key, Date.now() + BACKGROUND_REFRESH_RETRY_MS);
  });
  ctx.waitUntil(task);
}


async function appendAudit(env: Env, action: "config.update" | "config.rollback" | "catalog.refresh" | "catalog.refresh.failed", detail?: string): Promise<void> {
  if (env.FLUXA_COORDINATOR) return appendAuditViaCoordinator(env, action, detail);
  return appendAuditEvent(env, action, detail);
}
function validateSecrets(env: Env): string | null {
  if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 24) return "ADMIN_TOKEN must be at least 24 characters";
  if (!env.SUB_TOKEN || env.SUB_TOKEN.length < 24) return "SUB_TOKEN must be at least 24 characters";
  if (!validUuid(env.CLIENT_UUID ?? "")) return "CLIENT_UUID must be a valid UUID";
  if (!env.TROJAN_PASSWORD || env.TROJAN_PASSWORD.length < 16) return "TROJAN_PASSWORD must be at least 16 characters";
  if (constantTimeEqual(env.ADMIN_TOKEN, env.SUB_TOKEN)) return "ADMIN_TOKEN and SUB_TOKEN must be different";
  if (constantTimeEqual(env.TROJAN_PASSWORD, env.SUB_TOKEN) || constantTimeEqual(env.TROJAN_PASSWORD, env.ADMIN_TOKEN)) return "TROJAN_PASSWORD must differ from administrative/subscription tokens";
  return null;
}
function json(data: unknown, status=200, extraHeaders: HeadersInit = {}): Response { const headers = new Headers(securityHeaders("application/json; charset=utf-8")); new Headers(extraHeaders).forEach((value,key)=>headers.set(key,value)); return new Response(JSON.stringify(data,null,2),{status,headers}); }
function securityHeaders(type: string, nonce?: string, allowScript=false): HeadersInit {
  const style = nonce ? `style-src 'nonce-${nonce}'` : "style-src 'none'";
  const script = allowScript && nonce ? `script-src 'nonce-${nonce}'` : "script-src 'none'";
  return {"content-type":type,"cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer","x-frame-options":"DENY","permissions-policy":"geolocation=(), microphone=(), camera=()","content-security-policy":`default-src 'none'; connect-src 'self'; img-src 'self' data:; ${style}; ${script}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`};
}
function homePage(nonce: string): string { return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Fluxa</title><style nonce="${nonce}">body{font:16px system-ui;max-width:760px;margin:64px auto;padding:0 20px}code{background:#eee;padding:2px 5px;border-radius:5px}</style><h1>Fluxa ${VERSION}</h1><p>Security-first edge proxy, quality catalog and multi-client subscription manager for Cloudflare Workers.</p><p>Health: <code>/health</code> · Capabilities: <code>/api/capabilities</code> · Admin: <code>/admin</code></p>`; }
