import type { ParsedProxyRequest } from "../types.js";
import { constantTimeEqual } from "../security.js";

export type ParseResult = { ok: true; value: ParsedProxyRequest } | { ok: false; needMore?: boolean; error?: string };

export function parseVlessRequest(data: Uint8Array, expectedUuid: string): ParseResult {
  if (data.length < 24) return { ok: false, needMore: true };
  const version = data[0];
  const uuid = bytesToUuid(data.slice(1, 17));
  if (!constantTimeEqual(uuid.toLowerCase(), expectedUuid.toLowerCase())) return { ok: false, error: "invalid client UUID" };
  const optLen = data[17];
  let i = 18 + optLen;
  if (data.length < i + 4) return { ok: false, needMore: true };
  const command = data[i++];
  if (command !== 1) return { ok: false, error: "only TCP command is supported" };
  const port = (data[i++] << 8) | data[i++];
  const atyp = data[i++];
  const address = parseAddress(data, i, atyp);
  if (!address.ok) return address;
  i = address.next;
  return { ok: true, value: { host: address.host, port, payload: data.slice(i), responsePrefix: new Uint8Array([version, 0]) } };
}

function parseAddress(data: Uint8Array, i: number, atyp: number):
  { ok: true; host: string; next: number } | { ok: false; needMore?: boolean; error?: string } {
  if (atyp === 1) {
    if (data.length < i + 4) return { ok: false, needMore: true };
    return { ok: true, host: Array.from(data.slice(i, i + 4)).join("."), next: i + 4 };
  }
  if (atyp === 2) {
    if (data.length < i + 1) return { ok: false, needMore: true };
    const len = data[i++];
    if (data.length < i + len) return { ok: false, needMore: true };
    return { ok: true, host: new TextDecoder().decode(data.slice(i, i + len)), next: i + len };
  }
  if (atyp === 3) {
    if (data.length < i + 16) return { ok: false, needMore: true };
    const parts: string[] = [];
    for (let p = 0; p < 16; p += 2) parts.push(((data[i + p] << 8) | data[i + p + 1]).toString(16));
    return { ok: true, host: parts.join(":"), next: i + 16 };
  }
  return { ok: false, error: "unsupported address type" };
}

export function bytesToUuid(b: Uint8Array): string {
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
}
