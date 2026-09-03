export interface Env {
  ADMIN_TOKEN: string;
  SUB_TOKEN: string;
  CLIENT_UUID: string;
  TROJAN_PASSWORD: string;
  FLUXA_KV?: KVNamespace;
  FLUXA_COORDINATOR?: DurableObjectNamespace;
  UPSTREAM_PROXY?: string;
  UPSTREAM_PROXY_MODE?: "off" | "cloudflare" | "always";
}

export interface FluxaConfig {
  schemaVersion: 2;
  title: string;
  protocols: {
    vless: boolean;
    trojan: boolean;
  };
  paths: {
    vless: string;
    trojan: string;
  };
  allowedTargetPorts: number[];
  edgeAddresses: string[];
  officialIpCount: number;
  maxSubscriptionNodes: number;
  sourceUrls: string[];
  quality: {
    minFluxScore: number;
    maxMisses: number;
    catalogMaxAgeMinutes: number;
    sourceTimeoutMs: number;
    sourceAddressLimit: number;
    thirdPartyIpv4MustBeCloudflare: boolean;
  };
}

export type NodeOrigin = "worker" | "manual" | "official" | "source";
export type NodeStatus = "recommended" | "healthy" | "probation" | "quarantined" | "retired";

export interface SourceHealth {
  url: string;
  attempts: number;
  successes: number;
  consecutiveFailures: number;
  lastSuccessAt?: string;
  lastError?: string;
  lastDurationMs?: number;
  lastRawItems: number;
  lastParsedItems: number;
  lastAcceptedItems: number;
  reputationScore: number;
  grade: "A" | "B" | "C" | "D" | "F";
}

export interface NodeCandidate {
  address: string;
  origins: NodeOrigin[];
  sources: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  misses: number;
  cloudflareIpv4: boolean;
  fluxScore: number;
  status: NodeStatus;
  reasons: string[];
}

export interface NodeCatalog {
  schemaVersion: 1;
  generatedAt: string;
  generatedForHost?: string;
  configFingerprint?: string;
  sourceHealth: SourceHealth[];
  nodes: NodeCandidate[];
  summary: {
    total: number;
    eligible: number;
    recommended: number;
    healthy: number;
    probation: number;
    quarantined: number;
    retired: number;
  };
}

export interface AuditEvent {
  id: string;
  at: string;
  action: "config.update" | "config.rollback" | "catalog.refresh" | "catalog.refresh.failed";
  detail?: string;
}

export interface ParsedProxyRequest {
  host: string;
  port: number;
  payload: Uint8Array;
  responsePrefix?: Uint8Array;
}
