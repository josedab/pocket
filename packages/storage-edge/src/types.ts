/**
 * Edge Storage Types
 *
 * Configuration types for all edge runtime storage adapters.
 *
 * @module @pocket/storage-edge/types
 */

/**
 * Custom serializer for edge storage adapters.
 *
 * Allows replacing the default JSON serialization with a custom
 * implementation (e.g., MessagePack, CBOR, etc.).
 */
export interface EdgeSerializer {
  /** Serialize a value to a string */
  serialize(value: unknown): string;
  /** Deserialize a string back to a value */
  deserialize<T>(data: string): T;
}

/**
 * Base configuration shared by all edge storage adapters.
 */
export interface EdgeStorageConfig {
  /** Key prefix for namespacing (default: "pocket:") */
  prefix?: string;
  /** Custom serializer (default: JSON.stringify/parse) */
  serializer?: EdgeSerializer;
}

// ---------------------------------------------------------------------------
// Cloudflare KV
// ---------------------------------------------------------------------------

/**
 * Minimal Cloudflare Workers KV Namespace interface.
 *
 * The actual implementation is provided by the Cloudflare Workers runtime.
 * This interface defines only the methods used by the adapter.
 */
export interface CloudflareKVNamespace {
  get(key: string, options?: { type?: 'text' | 'json' | 'arrayBuffer' | 'stream' }): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number; metadata?: unknown }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<CloudflareKVListResult>;
}

/**
 * Result of a Cloudflare KV list operation.
 */
export interface CloudflareKVListResult {
  keys: { name: string; expiration?: number; metadata?: unknown }[];
  list_complete: boolean;
  cursor?: string;
}

/**
 * Configuration for the Cloudflare KV storage adapter.
 */
export interface CloudflareKVConfig extends EdgeStorageConfig {
  /** Cloudflare KV namespace binding */
  namespace: CloudflareKVNamespace;
}

// ---------------------------------------------------------------------------
// Cloudflare Durable Objects
// ---------------------------------------------------------------------------

/**
 * Minimal Durable Object Storage interface.
 *
 * The actual implementation is provided by the Cloudflare Workers runtime.
 */
export interface DurableObjectStorageAPI {
  get<T = unknown>(key: string): Promise<T | undefined>;
  get<T = unknown>(keys: string[]): Promise<Map<string, T>>;
  put<T>(key: string, value: T): Promise<void>;
  put<T>(entries: Record<string, T>): Promise<void>;
  delete(key: string): Promise<boolean>;
  delete(keys: string[]): Promise<number>;
  deleteAll(): Promise<void>;
  list<T = unknown>(options?: DurableObjectListOptions): Promise<Map<string, T>>;
  transaction<T>(closure: (txn: DurableObjectTransaction) => Promise<T>): Promise<T>;
}

/**
 * Options for Durable Object storage list operations.
 */
export interface DurableObjectListOptions {
  start?: string;
  startAfter?: string;
  end?: string;
  prefix?: string;
  reverse?: boolean;
  limit?: number;
}

/**
 * Durable Object transaction handle.
 */
export interface DurableObjectTransaction {
  get<T = unknown>(key: string): Promise<T | undefined>;
  get<T = unknown>(keys: string[]): Promise<Map<string, T>>;
  put<T>(key: string, value: T): Promise<void>;
  put<T>(entries: Record<string, T>): Promise<void>;
  delete(key: string): Promise<boolean>;
  delete(keys: string[]): Promise<number>;
  rollback(): void;
}

/**
 * Configuration for the Durable Object storage adapter.
 */
export interface DurableObjectConfig extends EdgeStorageConfig {
  /** DurableObjectState.storage reference */
  storage: DurableObjectStorageAPI;
}

// ---------------------------------------------------------------------------
// Deno KV
// ---------------------------------------------------------------------------

/**
 * Minimal Deno.Kv interface.
 *
 * The actual implementation is provided by the Deno runtime.
 */
export interface DenoKv {
  get<T = unknown>(key: DenoKvKey): Promise<DenoKvEntry<T>>;
  set(key: DenoKvKey, value: unknown): Promise<{ ok: boolean; versionstamp: string }>;
  delete(key: DenoKvKey): Promise<void>;
  list<T = unknown>(selector: DenoKvListSelector, options?: { limit?: number }): DenoKvListIterator<T>;
  close(): void;
}

/** Deno KV key type (array of key parts) */
export type DenoKvKey = (string | number | boolean | Uint8Array | bigint)[];

/** Deno KV entry returned from get operations */
export interface DenoKvEntry<T> {
  key: DenoKvKey;
  value: T | null;
  versionstamp: string | null;
}

/** Deno KV list selector */
export interface DenoKvListSelector {
  prefix?: DenoKvKey;
  start?: DenoKvKey;
  end?: DenoKvKey;
}

/** Deno KV list iterator */
export interface DenoKvListIterator<T> {
  [Symbol.asyncIterator](): AsyncIterableIterator<DenoKvEntry<T>>;
}

/**
 * Configuration for the Deno KV storage adapter.
 */
export interface DenoKVConfig extends EdgeStorageConfig {
  /** Path to the Deno KV database file (optional, uses default if omitted) */
  path?: string;
}

// ---------------------------------------------------------------------------
// Vercel KV
// ---------------------------------------------------------------------------

/**
 * Minimal Vercel KV client interface (Redis-based).
 *
 * The actual implementation is provided by the @vercel/kv package.
 */
export interface VercelKVClient {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, options?: { ex?: number; px?: number }): Promise<string>;
  del(...keys: string[]): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  mget<T = unknown>(...keys: string[]): Promise<(T | null)[]>;
}

/**
 * Configuration for the Vercel KV storage adapter.
 */
export interface VercelKVConfig extends EdgeStorageConfig {
  /** Vercel KV REST API URL */
  url?: string;
  /** Vercel KV REST API token */
  token?: string;
  /** Pre-configured Vercel KV client (takes precedence over url/token) */
  client?: VercelKVClient;
}

// ---------------------------------------------------------------------------
// Bun SQLite
// ---------------------------------------------------------------------------

/**
 * Minimal Bun SQLite Database interface.
 *
 * The actual implementation is provided by the Bun runtime via bun:sqlite.
 */
export interface BunSQLiteDatabase {
  query(sql: string): BunSQLiteStatement;
  run(sql: string, ...params: unknown[]): void;
  exec(sql: string): void;
  close(): void;
  transaction<T>(fn: () => T): () => T;
}

/**
 * Bun SQLite prepared statement.
 */
export interface BunSQLiteStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown | null;
  run(...params: unknown[]): void;
}

/**
 * Configuration for the Bun SQLite storage adapter.
 */
export interface BunSQLiteConfig extends EdgeStorageConfig {
  /** Path to the SQLite database file (default: ":memory:") */
  filename?: string;
  /** Pre-configured Bun SQLite database instance */
  database?: BunSQLiteDatabase;
}
