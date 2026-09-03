import type { Env, FluxaConfig } from "./types.js";

export type SubscriptionFormat = "raw" | "uri" | "clash" | "singbox" | "loon" | "surge";
export type SubscriptionFormatInput = SubscriptionFormat | "auto" | "mihomo" | "v2rayn" | "v2rayng" | "shadowrocket";

export interface SubscriptionNode {
  type: "vless" | "trojan";
  name: string;
  address: string;
}

export const SUPPORTED_FORMATS: ReadonlyArray<SubscriptionFormat> = ["raw", "uri", "clash", "singbox", "loon", "surge"];

export function normalizeSubscriptionFormat(input: string | null, userAgent = ""): SubscriptionFormat | null {
  const value = (input ?? "auto").trim().toLowerCase() as SubscriptionFormatInput;
  if (value === "auto") return detectFormatFromUserAgent(userAgent);
  if (value === "mihomo") return "clash";
  if (value === "v2rayn" || value === "v2rayng" || value === "shadowrocket") return "raw";
  return SUPPORTED_FORMATS.includes(value as SubscriptionFormat) ? value as SubscriptionFormat : null;
}

export function detectFormatFromUserAgent(userAgent: string): SubscriptionFormat {
  const ua = userAgent.toLowerCase();
  if (ua.includes("sing-box") || ua.includes("singbox")) return "singbox";
  if (ua.includes("loon")) return "loon";
  if (ua.includes("surge")) return "surge";
  if (ua.includes("clash") || ua.includes("mihomo") || ua.includes("stash")) return "clash";
  return "raw";
}

export function generateSubscription(format: SubscriptionFormat, host: string, addresses: string[], cfg: FluxaConfig, env: Env): string {
  const nodes = buildNodes(addresses, cfg);
  if (format === "clash") return clash(nodes, host, cfg, env);
  if (format === "singbox") return singbox(nodes, host, cfg, env);
  if (format === "loon") return loon(nodes, host, cfg, env);
  if (format === "surge") return surge(nodes, host, cfg, env);
  const uris = uriLines(nodes, host, cfg, env).join("\n");
  return format === "uri" ? uris : utf8Base64(uris);
}

export function buildNodes(addresses: string[], cfg: FluxaConfig): SubscriptionNode[] {
  return addresses.flatMap((address, index) => {
    const baseName = safeNodeName(`${cfg.title}-${String(index + 1).padStart(2, "0")}`);
    const result: SubscriptionNode[] = [];
    if (cfg.protocols.vless) result.push({ type: "vless", name: `${baseName}-VLESS`, address });
    if (cfg.protocols.trojan) result.push({ type: "trojan", name: `${baseName}-Trojan`, address });
    return result;
  });
}

function uriLines(nodes: SubscriptionNode[], host: string, cfg: FluxaConfig, env: Env): string[] {
  return nodes.map((n) => n.type === "vless" ? vlessUri(n.name, n.address, host, cfg, env) : trojanUri(n.name, n.address, host, cfg, env));
}

function vlessUri(name: string, address: string, host: string, cfg: FluxaConfig, env: Env): string {
  const q = new URLSearchParams({ encryption:"none", security:"tls", sni:host, type:"ws", host, path:cfg.paths.vless });
  return `vless://${env.CLIENT_UUID}@${uriHost(address)}:443?${q.toString()}#${encodeURIComponent(name)}`;
}
function trojanUri(name: string, address: string, host: string, cfg: FluxaConfig, env: Env): string {
  const q = new URLSearchParams({ security:"tls", sni:host, type:"ws", host, path:cfg.paths.trojan });
  return `trojan://${encodeURIComponent(env.TROJAN_PASSWORD)}@${uriHost(address)}:443?${q.toString()}#${encodeURIComponent(name)}`;
}

function clash(nodes: SubscriptionNode[], host: string, cfg: FluxaConfig, env: Env): string {
  const proxies = nodes.map((n) => {
    const common = [
      `  - name: ${yaml(n.name)}`,
      `    type: ${n.type}`,
      `    server: ${yaml(n.address)}`,
      `    port: 443`,
      ...(n.type === "vless"
        ? [`    uuid: ${yaml(env.CLIENT_UUID)}`, `    encryption: ${yaml("")}`, `    udp: false`]
        : [`    password: ${yaml(env.TROJAN_PASSWORD)}`, `    udp: false`]),
      `    tls: true`,
      `    servername: ${yaml(host)}`,
      `    network: ws`,
      `    ws-opts:`,
      `      path: ${yaml(n.type === "vless" ? cfg.paths.vless : cfg.paths.trojan)}`,
      `      headers:`,
      `        Host: ${yaml(host)}`
    ];
    return common.join("\n");
  }).join("\n");
  const names = nodes.map((n) => `      - ${yaml(n.name)}`).join("\n");
  return `mixed-port: 7890\nallow-lan: false\nmode: rule\nlog-level: info\nproxies:\n${proxies}\nproxy-groups:\n  - name: ${yaml("🚀 Fluxa")}`+
    `\n    type: select\n    proxies:\n${names}\nrules:\n  - MATCH,${yaml("🚀 Fluxa")}\n`;
}

function singbox(nodes: SubscriptionNode[], host: string, cfg: FluxaConfig, env: Env): string {
  const outbounds = nodes.map((n) => n.type === "vless" ? {
    type:"vless", tag:n.name, server:n.address, server_port:443, uuid:env.CLIENT_UUID,
    network:"tcp", tls:{ enabled:true, server_name:host }, transport:{ type:"ws", path:cfg.paths.vless, headers:{ Host:host } }
  } : {
    type:"trojan", tag:n.name, server:n.address, server_port:443, password:env.TROJAN_PASSWORD,
    network:"tcp", tls:{ enabled:true, server_name:host }, transport:{ type:"ws", path:cfg.paths.trojan, headers:{ Host:host } }
  });
  return JSON.stringify({
    log:{level:"info"},
    outbounds:[{type:"selector",tag:"fluxa",outbounds:nodes.map(n=>n.name)},...outbounds],
    route:{ final:"fluxa" }
  }, null, 2);
}

function loon(nodes: SubscriptionNode[], host: string, cfg: FluxaConfig, env: Env): string {
  const lines = nodes.map((n) => {
    const name = iniName(n.name);
    const address = iniValue(n.address);
    if (n.type === "vless") {
      return `${name} = VLESS,${address},443,${quoted(env.CLIENT_UUID)},transport=ws,path=${iniValue(cfg.paths.vless)},host=${iniValue(host)},over-tls=true,sni=${iniValue(host)},skip-cert-verify=false,udp=false`;
    }
    return `${name} = trojan,${address},443,${quoted(env.TROJAN_PASSWORD)},transport=ws,path=${iniValue(cfg.paths.trojan)},host=${iniValue(host)},alpn=http1.1,sni=${iniValue(host)},udp=false`;
  });
  const names = nodes.map((n) => iniName(n.name)).join(",");
  return `[Proxy]\n${lines.join("\n")}\n\n[Proxy Group]\nFluxa = select,${names}\n`;
}

function surge(nodes: SubscriptionNode[], host: string, cfg: FluxaConfig, env: Env): string {
  // Surge documents Trojan+WebSocket, but not VLESS. Emit only protocol entries with documented compatibility.
  const compatible = nodes.filter((n) => n.type === "trojan");
  const lines = compatible.map((n) => `${iniName(n.name)} = trojan, ${iniValue(n.address)}, 443, password=${iniValue(env.TROJAN_PASSWORD)}, ws=true, ws-path=${iniValue(cfg.paths.trojan)}, ws-headers=Host:${iniValue(host)}, sni=${iniValue(host)}`);
  if (!lines.length) return `# Fluxa: Surge output requires the Trojan protocol to be enabled.\n`;
  const names = compatible.map((n) => iniName(n.name)).join(", ");
  return `[Proxy]\n${lines.join("\n")}\n\n[Proxy Group]\nFluxa = select, ${names}\n\n[Rule]\nFINAL,Fluxa\n`;
}

function yaml(v: string): string { return JSON.stringify(v); }
function uriHost(v: string): string { return v.includes(":") && !v.startsWith("[") ? `[${v}]` : v; }
function safeNodeName(v: string): string { return v.replace(/[\r\n\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Fluxa"; }
function iniName(v: string): string { return safeNodeName(v).replace(/[,=]/g, "-"); }
function iniValue(v: string): string { return String(v).replace(/[\r\n,]/g, "").trim(); }
function quoted(v: string): string { return `"${String(v).replace(/["\\\r\n]/g, "")}"`; }

function utf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
