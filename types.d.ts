declare module "cloudflare:sockets" {
  export interface Socket {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
    opened: Promise<{ remoteAddress?: string | null; localAddress?: string | null }>;
    closed: Promise<void>;
    close(): Promise<void>;
  }
  export function connect(address: { hostname: string; port: number }, options?: { secureTransport?: "off" | "on" | "starttls"; allowHalfOpen?: boolean }): Socket;
}

declare interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

declare interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException?(): void;
}

declare interface ScheduledController {
  scheduledTime: number;
  cron: string;
}

declare class WebSocketPair {
  0: WebSocket;
  1: WebSocket;
}

interface WebSocket {
  accept(): void;
}

declare module "node:crypto" {
  interface Hash { update(data: string | Uint8Array): Hash; digest(encoding: "hex"): string; }
  export function createHash(algorithm: string): Hash;
}


declare interface DurableObjectId {}
declare interface DurableObjectStub {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}
declare interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}
declare interface DurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
}
declare interface DurableObjectState {
  storage: DurableObjectStorage;
}
declare module "cloudflare:workers" {
  export class DurableObject<Env = unknown> {
    protected readonly ctx: DurableObjectState;
    protected readonly env: Env;
    constructor(ctx: DurableObjectState, env: Env);
  }
}
