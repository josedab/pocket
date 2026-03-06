/**
 * Compatibility Layers - API-compatible shims for competitor databases.
 *
 * @module compat
 */

// Types
export type { CompatLayerConfig, DexieCompatAPI, RxDBCompatAPI } from './types.js';

// RxDB Compat
export { RxDBCompatLayer, createRxDBCompat } from './rxdb-compat.js';

// Dexie Compat
export { DexieCompatLayer, createDexieCompat } from './dexie-compat.js';
