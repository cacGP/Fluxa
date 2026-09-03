import { withTimeout } from "./async-utils.js";
import type { Env, FluxaConfig, NodeCatalog } from "./types.js";

export const COORDINATOR_TIMEOUT_MS = 25_000;

export async function refreshViaCoordinator(env: Env, config: FluxaConfig): Promise<NodeCatalog> {
  if (!env.FLUXA_COORDINATOR) throw new Error("FLUXA_COORDINATOR Durable Object binding is not configured");
  const id = env.FLUXA_COORDINATOR.idFromName("catalog");
  const stub = env.FLUXA_COORDINATOR.get(id);
  const response = await withTimeout(
    stub.fetch("https://fluxa.internal/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config })
    }),
    COORDINATOR_TIMEOUT_MS,
    "global catalog coordinator timed out"
  );
  const text = await response.text();
  let data: unknown;
  try { data = JSON.parse(text); }
  catch { throw new Error(`global catalog coordinator returned invalid JSON (${response.status})`); }
  if (!response.ok || !data || typeof data !== "object" || !("catalog" in data)) {
    const error = data && typeof data === "object" && "error" in data ? String((data as { error?: unknown }).error ?? "") : "";
    throw new Error(error || `global catalog coordinator failed (${response.status})`);
  }
  return (data as { catalog: NodeCatalog }).catalog;
}
