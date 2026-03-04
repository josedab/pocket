/**
 * Migration Bridges - Competitor database migration bridges for Pocket.
 *
 * @module bridges
 */

// Types
export type {
  BridgeMigrationConfig,
  BridgeMigrationProgress,
  BridgeMigrationResult,
  CollectionMigrationResult,
  CompetitorDB,
  DatabaseInspection,
  SchemaMapping,
} from './types.js';

// RxDB Bridge
export { RxDBMigrationBridge, createRxDBBridge } from './rxdb-bridge.js';

// PouchDB Bridge
export { PouchDBMigrationBridge, createPouchDBBridge } from './pouchdb-bridge.js';

// Dexie Bridge
export { DexieMigrationBridge, createDexieBridge } from './dexie-bridge.js';

// WatermelonDB Bridge
export { WatermelonDBMigrationBridge, createWatermelonDBBridge } from './watermelondb-bridge.js';
