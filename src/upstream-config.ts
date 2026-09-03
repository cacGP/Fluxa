import { isValidPublicHostname } from "./security.js";

export interface UpstreamProxyConfig {
  hostname: string;
  port: number;
  secure: boolean;
  username?: string;
  password?: string;
}

export function parseUpstreamProxy(value: string): UpstreamProxyConfig {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("UPSTREAM_PROXY must be a valid http:// or https:// URL"); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("UPSTREAM_PROXY only supports HTTP CONNECT proxies");
  if (!isValidPublicHostname(url.hostname)) throw new Error("UPSTREAM_PROXY hostname must be public");
  if (url.pathname !== "/" || url.search || url.hash) throw new Error("UPSTREAM_PROXY must not contain a path, query, or fragment");
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 8080;
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 25) throw new Error("UPSTREAM_PROXY has an invalid port");
  return {
    hostname: url.hostname,
    port,
    secure: url.protocol === "https:",
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {})
  };
}
