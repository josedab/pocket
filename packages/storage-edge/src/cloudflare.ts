/**
 * Cloudflare Edge Storage Adapters
 *
 * Exports all Cloudflare-specific storage adapters:
 * - Cloudflare Workers KV
 * - Cloudflare Durable Objects
 * - Cloudflare D1 (legacy adapter)
 *
 * @module @pocket/storage-edge/cloudflare
 */

// Cloudflare Workers KV
export { CloudflareKVStore } from './cloudflare/cloudflare-store.js';
export { createCloudflareKVStorage } from './cloudflare/cloudflare-adapter.js';

// Cloudflare Durable Objects
export { DurableObjectStore } from './cloudflare/durable-object-store.js';
export { createDurableObjectStorage } from './cloudflare/durable-object-adapter.js';

// Types
export type {
  CloudflareKVConfig,
  CloudflareKVNamespace,
  CloudflareKVListResult,
  DurableObjectConfig,
  DurableObjectStorageAPI,
  DurableObjectListOptions,
  DurableObjectTransaction,
} from './types.js';

// Re-export core types for convenience
export type { Document, StorageAdapter, StorageConfig } from '@pocket/core';
