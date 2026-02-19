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
export { createCloudflareKVStorage } from './cloudflare/cloudflare-adapter.js';
export { CloudflareKVStore } from './cloudflare/cloudflare-store.js';

// Cloudflare Durable Objects
export { createDurableObjectStorage } from './cloudflare/durable-object-adapter.js';
export { DurableObjectStore } from './cloudflare/durable-object-store.js';

// Legacy D1 adapter
export { createD1Storage, type D1StorageConfig } from './d1-adapter.js';

// Legacy Durable Objects adapter
export {
  createDurableObjectStorage as createLegacyDurableObjectStorage,
  type DurableObjectStorageConfig,
} from './durable-objects-adapter.js';

// Deno KV
export { createDenoKVStorage } from './deno/deno-kv-adapter.js';
export { DenoKVStore } from './deno/deno-kv-store.js';

// Vercel KV
export { createVercelKVStorage } from './vercel/vercel-kv-adapter.js';
export { VercelKVStore } from './vercel/vercel-kv-store.js';

// Bun SQLite
export { createBunSQLiteStorage } from './bun/bun-sqlite-adapter.js';
export { BunSQLiteStore } from './bun/bun-sqlite-store.js';

// All types
export type {
  BunSQLiteConfig,
  BunSQLiteDatabase,
  BunSQLiteStatement,
  CloudflareKVConfig,
  CloudflareKVListResult,
  CloudflareKVNamespace,
  DenoKVConfig,
  DenoKv,
  DenoKvEntry,
  DenoKvKey,
  DenoKvListIterator,
  DenoKvListSelector,
  DurableObjectConfig,
  DurableObjectListOptions,
  DurableObjectStorageAPI,
  DurableObjectTransaction,
  EdgeSerializer,
  EdgeStorageConfig,
  VercelKVClient,
  VercelKVConfig,
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
export { InMemorySyncStorage, createInMemorySyncStorage } from './in-memory-sync-storage.js';

// Auto-configuration
export {
  createAutoConfig,
  createAutoConfiguredStorage,
  detectPlatform,
  getRecommendedConfig,
  type AutoConfigOptions,
  type AutoConfigResult,
  type Platform,
  type PlatformConfig,
} from './auto-config.js';

// Deployment Manager
export {
  createDeploymentManager,
  type DeploymentConfig,
  type DeploymentManager,
  type DeploymentManagerConfig,
  type DeploymentProvider,
  type ProviderInfo,
  type ResourceEstimate,
  type ValidationResult,
} from './deployment-manager.js';

// Health Monitor
export {
  createEdgeHealthMonitor,
  type EdgeHealthMonitor,
  type EndpointHealth,
  type HealthMonitorConfig,
} from './health-monitor.js';

// Global Sync Mesh
export {
  GlobalSyncMesh,
  createGlobalSyncMesh,
  type EdgeRegion,
  type GlobalSyncMeshConfig,
  type MeshMetrics,
  type RegionNodeInfo,
  type RegionNodeStatus,
  type ReplicationEvent,
  type ReplicationStrategy,
  type RoutingDecision,
} from './global-sync-mesh.js';

// Health Dashboard
export {
  buildHealthDashboard,
  type AlertThresholds,
  type HealthAlert,
  type HealthDashboardSnapshot,
  type LatencyPercentiles,
  type RegionHealthSummary,
} from './health-dashboard.js';

// Region Failover
export {
  RegionFailoverManager,
  createRegionFailoverManager,
  type FailoverConfig,
  type FailoverEvent,
  type FailoverState,
} from './region-failover.js';

// Cache Warmer
export {
  CacheWarmer,
  createCacheWarmer,
  type AccessPattern,
  type CacheWarmerConfig,
  type PrefetchRequest,
  type PrefetchResult,
} from './cache-warmer.js';

// Re-export core types for convenience
export type { Document, StorageAdapter, StorageConfig } from '@pocket/core';
