export async function readJsonLimited<T = unknown>(request: Request, maxBytes: number): Promise<T> {
  if (!Number.isInteger(maxBytes) || maxBytes < 1) throw new Error("invalid request size limit");
  const type = (request.headers.get("content-type") ?? "").toLowerCase();
  if (!type.startsWith("application/json")) throw new Error("content-type must be application/json");
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("request body is too large");
  if (!request.body) throw new Error("request body is required");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.length;
      if (size > maxBytes) throw new Error("request body is too large");
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch { /* best effort */ }
  }

  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(merged)) as T; }
  catch { throw new Error("request body is not valid JSON"); }
}

export function safeDecodePathComponent(value: string): string | null {
  try { return decodeURIComponent(value); }
  catch { return null; }
}

export function randomCspNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
