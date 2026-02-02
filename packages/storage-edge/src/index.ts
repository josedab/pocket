/**
 * @pocket/storage-edge - Edge Runtime Storage Adapters
 *
 * Provides storage adapters for edge runtime environments:
 *
 * - **Cloudflare Workers KV** - Globally distributed, eventually consistent KV store
 * - **Cloudflare Durable Objects** - Strongly consistent, co-located storage with transactions
 * - **Cloudflare D1** - Edge SQLite database (legacy adapter)
 * - **Deno KV** - Built-in KV database for Deno and Deno Deploy
 * - **Vercel KV** - Redis-based KV store for Vercel Edge/Serverless
 * - **Bun SQLite** - High-performance built-in SQLite for Bun runtime
 *
 * Each adapter can be imported individually via subpath exports:
 *
 * ```typescript
 * import { createCloudflareKVStorage } from '@pocket/storage-edge/cloudflare';
 * import { createDenoKVStorage } from '@pocket/storage-edge/deno';
 * import { createVercelKVStorage } from '@pocket/storage-edge/vercel';
 * import { createBunSQLiteStorage } from '@pocket/storage-edge/bun';
 * ```
 *
 * Or import everything from the main entry:
 *
 * ```typescript
 * import { createCloudflareKVStorage, createDenoKVStorage } from '@pocket/storage-edge';
 * ```
 *
 * @module @pocket/storage-edge
 */

// Base KV store (for custom adapter implementations)
export { BaseKVDocumentStore, type KVListEntry } from './base-kv-store.js';

// Cloudflare Workers KV
export { CloudflareKVStore } from './cloudflare/cloudflare-store.js';
export { createCloudflareKVStorage } from './cloudflare/cloudflare-adapter.js';

// Cloudflare Durable Objects
export { DurableObjectStore } from './cloudflare/durable-object-store.js';
export { createDurableObjectStorage } from './cloudflare/durable-object-adapter.js';

// Legacy D1 adapter
export { createD1Storage, type D1StorageConfig } from './d1-adapter.js';

// Legacy Durable Objects adapter
export {
  createDurableObjectStorage as createLegacyDurableObjectStorage,
  type DurableObjectStorageConfig,
} from './durable-objects-adapter.js';

// Deno KV
export { DenoKVStore } from './deno/deno-kv-store.js';
export { createDenoKVStorage } from './deno/deno-kv-adapter.js';

// Vercel KV
export { VercelKVStore } from './vercel/vercel-kv-store.js';
export { createVercelKVStorage } from './vercel/vercel-kv-adapter.js';

// Bun SQLite
export { BunSQLiteStore } from './bun/bun-sqlite-store.js';
export { createBunSQLiteStorage } from './bun/bun-sqlite-adapter.js';

// All types
export type {
  EdgeStorageConfig,
  EdgeSerializer,
  CloudflareKVConfig,
  CloudflareKVNamespace,
  CloudflareKVListResult,
  DurableObjectConfig,
  DurableObjectStorageAPI,
  DurableObjectListOptions,
  DurableObjectTransaction,
  DenoKVConfig,
  DenoKv,
  DenoKvKey,
  DenoKvEntry,
  DenoKvListSelector,
  DenoKvListIterator,
  VercelKVConfig,
  VercelKVClient,
  BunSQLiteConfig,
  BunSQLiteDatabase,
  BunSQLiteStatement,
} from './types.js';

// Edge Sync Server
export {
  EdgeSyncServer,
  createEdgeSyncServer,
  type AuthResult,
  type EdgeRequest,
  type EdgeResponse,
  type EdgeSyncConfig,
  type EdgeSyncStats,
  type EdgeSyncStorage,
  type SyncChange,
} from './edge-sync-server.js';

// In-Memory Sync Storage (for testing)
export {
  InMemorySyncStorage,
  createInMemorySyncStorage,
} from './in-memory-sync-storage.js';

// Auto-configuration
export {
  detectPlatform,
  createAutoConfiguredStorage,
  getRecommendedConfig,
  createAutoConfig,
  type Platform,
  type AutoConfigOptions,
  type AutoConfigResult,
  type PlatformConfig,
} from './auto-config.js';

// Re-export core types for convenience
export type { Document, StorageAdapter, StorageConfig } from '@pocket/core';
