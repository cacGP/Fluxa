import { createHash } from "node:crypto";
import type { ParsedProxyRequest } from "../types.js";
import type { ParseResult } from "./vless.js";
import { constantTimeEqual } from "../security.js";

export function trojanPasswordHash(password: string): string {
  return createHash("sha224").update(password).digest("hex");
}

export function parseTrojanRequest(data: Uint8Array, password: string): ParseResult {
  if (data.length < 60) return { ok: false, needMore: true };
  const decoder = new TextDecoder();
  const hash = decoder.decode(data.slice(0, 56));
  if (!/^[0-9a-f]{56}$/i.test(hash) || !constantTimeEqual(hash.toLowerCase(), trojanPasswordHash(password))) {
    return { ok: false, error: "invalid Trojan password" };
  }
  if (data[56] !== 13 || data[57] !== 10) return { ok: false, error: "invalid Trojan header" };
  let i = 58;
  const command = data[i++];
  if (command !== 1) return { ok: false, error: "only CONNECT is supported" };
  const atyp = data[i++];
  const address = parseAddress(data, i, atyp);
  if (!address.ok) return address;
  i = address.next;
  if (data.length < i + 4) return { ok: false, needMore: true };
  const port = (data[i++] << 8) | data[i++];
  if (data[i++] !== 13 || data[i++] !== 10) return { ok: false, error: "invalid Trojan CRLF" };
  return { ok: true, value: { host: address.host, port, payload: data.slice(i) } };
}

function parseAddress(data: Uint8Array, i: number, atyp: number):
  { ok: true; host: string; next: number } | { ok: false; needMore?: boolean; error?: string } {
  if (atyp === 1) {
    if (data.length < i + 4) return { ok: false, needMore: true };
    return { ok: true, host: Array.from(data.slice(i, i + 4)).join("."), next: i + 4 };
  }
  if (atyp === 3) {
    if (data.length < i + 1) return { ok: false, needMore: true };
    const len = data[i++];
    if (data.length < i + len) return { ok: false, needMore: true };
    return { ok: true, host: new TextDecoder().decode(data.slice(i, i + len)), next: i + len };
  }
  if (atyp === 4) {
    if (data.length < i + 16) return { ok: false, needMore: true };
    const parts: string[] = [];
    for (let p = 0; p < 16; p += 2) parts.push(((data[i + p] << 8) | data[i + p + 1]).toString(16));
    return { ok: true, host: parts.join(":"), next: i + 16 };
  }
  return { ok: false, error: "unsupported address type" };
}
