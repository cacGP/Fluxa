import { VERSION } from "./constants.js";
import type { SubscriptionFormat } from "./subscriptions.js";

export async function subscriptionResponse(request: Request, format: SubscriptionFormat, body: string): Promise<Response> {
  const etag = await weakEtag(body);
  const headers = subscriptionHeaders(format, etag);
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  if (request.method === "HEAD") return new Response(null, { status: 200, headers });
  return new Response(body, { status: 200, headers });
}

export function subscriptionHeaders(format: SubscriptionFormat, etag?: string): HeadersInit {
  return {
    "content-type": contentType(format),
    "cache-control": "private, max-age=60, must-revalidate",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-fluxa-version": VERSION,
    "x-fluxa-format": format,
    "profile-update-interval": "24",
    ...(etag ? { etag } : {})
  };
}

export function contentType(format: SubscriptionFormat): string {
  if (format === "clash") return "text/yaml; charset=utf-8";
  if (format === "singbox") return "application/json; charset=utf-8";
  return "text/plain; charset=utf-8";
}

async function weakEtag(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const bytes = new Uint8Array(digest).subarray(0, 12);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const tag = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `W/"${tag}"`;
}
