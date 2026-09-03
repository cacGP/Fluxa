import type { FluxaConfig } from "./types.js";

export const VERSION = "0.8.0";
export const CONFIG_KEY = "config:v2";
export const LEGACY_CONFIG_KEY = "config:v1";
export const CATALOG_KEY = "catalog:v1";
export const AUDIT_KEY = "audit:v1";
export const CONFIG_HISTORY_KEY = "config-history:v1";

export const DEFAULT_CONFIG: FluxaConfig = {
  schemaVersion: 2,
  title: "Fluxa",
  protocols: { vless: true, trojan: true },
  paths: { vless: "/ws/vless", trojan: "/ws/trojan" },
  allowedTargetPorts: [80, 443],
  edgeAddresses: [],
  officialIpCount: 8,
  maxSubscriptionNodes: 32,
  sourceUrls: [],
  quality: {
    minFluxScore: 60,
    maxMisses: 2,
    catalogMaxAgeMinutes: 360,
    sourceTimeoutMs: 4500,
    sourceAddressLimit: 256,
    thirdPartyIpv4MustBeCloudflare: true
  }
};
