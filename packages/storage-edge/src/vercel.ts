/**
 * Vercel KV Storage Adapter
 *
 * @module @pocket/storage-edge/vercel
 */

// Vercel KV
export { VercelKVStore } from './vercel/vercel-kv-store.js';
export { createVercelKVStorage } from './vercel/vercel-kv-adapter.js';

// Types
export type {
  VercelKVConfig,
  VercelKVClient,
} from './types.js';

// Re-export core types for convenience
export type { Document, StorageAdapter, StorageConfig } from '@pocket/core';
