import type { Socket } from "cloudflare:sockets";
import { isValidPublicHostname } from "../security.js";
import type { Env, FluxaConfig, ParsedProxyRequest } from "../types.js";
import { parseVlessRequest } from "../protocols/vless.js";
import { parseTrojanRequest } from "../protocols/trojan.js";
import { openOutbound } from "../upstream.js";
import { createSerialExecutor } from "../async-utils.js";

export const PROXY_HANDSHAKE_TIMEOUT_MS = 15_000;
export const MAX_WS_FRAME_BYTES = 4 * 1024 * 1024;

export async function upgradeProxy(request: Request, env: Env, cfg: FluxaConfig, protocol: "vless"|"trojan"): Promise<Response> {
  if ((request.headers.get("Upgrade") ?? "").toLowerCase() !== "websocket") return new Response("WebSocket upgrade required", { status: 426 });
  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];
  server.accept();
  const workerHost = new URL(request.url).hostname;
  void runSession(server, env, cfg, protocol, workerHost);
  return new Response(null, { status: 101, webSocket: client } as ResponseInit & { webSocket: WebSocket });
}

async function runSession(ws: WebSocket, env: Env, cfg: FluxaConfig, protocol: "vless"|"trojan", workerHost: string): Promise<void> {
  let header = new Uint8Array();
  let socket: Socket | undefined;
  let writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
  let closed = false;
  const handshakeTimer = setTimeout(() => {
    if (!writer) closeAll();
  }, PROXY_HANDSHAKE_TIMEOUT_MS);

  const closeAll = () => {
    if (closed) return;
    closed = true;
    clearTimeout(handshakeTimer);
    try { writer?.releaseLock(); } catch {}
    try { void socket?.close(); } catch {}
    try { ws.close(); } catch {}
  };

  const queue = createSerialExecutor(() => closeAll());
  ws.addEventListener("close", closeAll);
  ws.addEventListener("error", closeAll);
  ws.addEventListener("message", (event: MessageEvent) => {
    const data = event.data;
    queue.enqueue(async () => {
      if (closed) return;
      const chunk = await toBytes(data);
      if (chunk.length > MAX_WS_FRAME_BYTES) throw new Error("WebSocket frame too large");
      if (writer) { await writer.write(chunk); return; }
      header = concat(header, chunk);
      if (header.length > 16 * 1024) throw new Error("proxy header too large");
      const parsed = protocol === "vless" ? parseVlessRequest(header, env.CLIENT_UUID) : parseTrojanRequest(header, env.TROJAN_PASSWORD);
      if (!parsed.ok) {
        if (parsed.needMore) return;
        throw new Error(parsed.error ?? "invalid proxy request");
      }
      assertTarget(parsed.value, cfg, workerHost);
      const outbound = await openOutbound(parsed.value, env);
      if (closed) { try { await outbound.socket.close(); } catch {} return; }
      socket = outbound.socket;
      writer = socket.writable.getWriter();
      clearTimeout(handshakeTimer);
      if (parsed.value.payload.length) await writer.write(parsed.value.payload);
      header = new Uint8Array();
      void pumpRemote(socket, ws, parsed.value.responsePrefix, outbound.initialRemoteData, closeAll);
    });
  });
}

function assertTarget(req: ParsedProxyRequest, cfg: FluxaConfig, workerHost: string): void {
  if (!isValidPublicHostname(req.host)) throw new Error("private or invalid target blocked");
  if (req.host.toLowerCase().replace(/^\[|\]$/g, "") === workerHost.toLowerCase()) throw new Error("TCP loop target blocked");
  if (!cfg.allowedTargetPorts.includes(req.port)) throw new Error("target port is not allowed");
}

async function pumpRemote(socket: Socket, ws: WebSocket, prefix: Uint8Array | undefined, initialRemoteData: Uint8Array, done: () => void): Promise<void> {
  const reader = socket.readable.getReader();
  let first = true;
  try {
    if (initialRemoteData.length) {
      ws.send(prefix?.length ? concat(prefix, initialRemoteData) : initialRemoteData);
      first = false;
    }
    while (true) {
      const { value, done: ended } = await reader.read();
      if (ended) break;
      if (!value?.length) continue;
      if (first && prefix?.length) ws.send(concat(prefix, value)); else ws.send(value);
      first = false;
    }
  } catch {} finally { reader.releaseLock(); done(); }
}

async function toBytes(data: unknown): Promise<Uint8Array> {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  throw new Error("binary WebSocket frames required");
}
function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length); out.set(a); out.set(b, a.length); return out;
}
