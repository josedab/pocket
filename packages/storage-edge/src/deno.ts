/**
 * Deno KV Storage Adapter
 *
 * @module @pocket/storage-edge/deno
 */

// Deno KV
export { DenoKVStore } from './deno/deno-kv-store.js';
export { createDenoKVStorage } from './deno/deno-kv-adapter.js';

// Types
export type {
  DenoKVConfig,
  DenoKv,
  DenoKvKey,
  DenoKvEntry,
  DenoKvListSelector,
  DenoKvListIterator,
} from './types.js';

// Re-export core types for convenience
export type { Document, StorageAdapter, StorageConfig } from '@pocket/core';
