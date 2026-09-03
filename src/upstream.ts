import { connect, type Socket } from "cloudflare:sockets";
import type { Env, ParsedProxyRequest } from "./types.js";
import { parseUpstreamProxy, type UpstreamProxyConfig } from "./upstream-config.js";
import { withTimeout } from "./async-utils.js";
import { destinationMayBeCloudflare, resolvePublicTarget, resolvedTargetMayBeCloudflare, type ResolvedPublicTarget } from "./dns-security.js";

export interface OutboundConnection {
  socket: Socket;
  initialRemoteData: Uint8Array;
  route: "direct" | "upstream";
}

const SOCKET_OPEN_TIMEOUT_MS = 10_000;
const CONNECT_HANDSHAKE_TIMEOUT_MS = 10_000;

export async function openOutbound(target: ParsedProxyRequest, env: Env): Promise<OutboundConnection> {
  const upstream = env.UPSTREAM_PROXY ? parseUpstreamProxy(env.UPSTREAM_PROXY) : null;
  const mode = env.UPSTREAM_PROXY_MODE ?? (upstream ? "cloudflare" : "off");
  let resolved: ResolvedPublicTarget | null = null;

  if (upstream && mode !== "off") {
    try { resolved = await resolvePublicTarget(target.host); }
    catch (error) {
      // Selective mode can still safely try Cloudflare's native direct socket, which itself blocks private/localhost targets.
      if (mode === "always") throw error;
    }
  }

  if (upstream && mode !== "off" && resolved && (mode === "always" || await resolvedTargetMayBeCloudflare(resolved))) {
    return openHttpConnectProxy(upstream, target, resolved.selectedAddress);
  }

  let direct: Socket | undefined;
  try {
    direct = connect({ hostname: target.host, port: target.port });
    await withTimeout(direct.opened, SOCKET_OPEN_TIMEOUT_MS, "direct TCP connect timed out");
    return { socket: direct, initialRemoteData: new Uint8Array(), route: "direct" };
  } catch (error) {
    if (direct) { try { await direct.close(); } catch { /* best effort */ } }
    // Never hand an unresolved hostname to an upstream proxy: doing so would let the proxy perform a second,
    // potentially different DNS resolution and re-introduce DNS-rebinding/private-network risk.
    if (upstream && mode === "cloudflare" && resolved) return openHttpConnectProxy(upstream, target, resolved.selectedAddress);
    throw error;
  }
}

export { destinationMayBeCloudflare };

async function openHttpConnectProxy(proxy: UpstreamProxyConfig, target: ParsedProxyRequest, resolvedAddress: string): Promise<OutboundConnection> {
  const socket = connect({ hostname: proxy.hostname, port: proxy.port }, { secureTransport: proxy.secure ? "on" : "off" });
  try {
    await withTimeout(socket.opened, SOCKET_OPEN_TIMEOUT_MS, "upstream proxy TCP connect timed out");
    const writer = socket.writable.getWriter();
    const authorityHost = resolvedAddress.includes(":") ? `[${resolvedAddress}]` : resolvedAddress;
    const authority = `${authorityHost}:${target.port}`;
    const lines = [`CONNECT ${authority} HTTP/1.1`, `Host: ${authority}`, "Proxy-Connection: Keep-Alive"];
    if (proxy.username !== undefined) lines.push(`Proxy-Authorization: Basic ${base64Utf8(`${proxy.username}:${proxy.password ?? ""}`)}`);
    await writer.write(new TextEncoder().encode(lines.join("\r\n") + "\r\n\r\n"));
    writer.releaseLock();

    const reader = socket.readable.getReader();
    let buffered = new Uint8Array();
    try {
      const deadline = Date.now() + CONNECT_HANDSHAKE_TIMEOUT_MS;
      while (buffered.length < 16 * 1024) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error("upstream CONNECT handshake timed out");
        const { value, done } = await withTimeout(reader.read(), remaining, "upstream CONNECT handshake timed out");
        if (done) throw new Error("upstream proxy closed during CONNECT");
        if (!value) continue;
        buffered = concat(buffered, value);
        const end = findHeaderEnd(buffered);
        if (end < 0) continue;
        const head = new TextDecoder().decode(buffered.slice(0, end));
        const status = head.match(/^HTTP\/1\.[01]\s+(\d{3})\b/i);
        if (!status || Number(status[1]) < 200 || Number(status[1]) >= 300) throw new Error(`upstream CONNECT rejected: ${status?.[1] ?? "invalid response"}`);
        return { socket, initialRemoteData: buffered.slice(end + 4), route: "upstream" };
      }
      throw new Error("upstream CONNECT response too large");
    } finally { reader.releaseLock(); }
  } catch (error) {
    try { await socket.close(); } catch { /* best effort */ }
    throw error;
  }
}

function findHeaderEnd(bytes: Uint8Array): number {
  for (let i = 0; i + 3 < bytes.length; i++) if (bytes[i] === 13 && bytes[i+1] === 10 && bytes[i+2] === 13 && bytes[i+3] === 10) return i;
  return -1;
}
function concat(a: Uint8Array, b: Uint8Array): Uint8Array { const out = new Uint8Array(a.length+b.length); out.set(a); out.set(b,a.length); return out; }
function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value); let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
