/**
 * @pocket/migration - One-Click Migration Toolkit for Pocket
 *
 * This package provides adapters and a migration engine for migrating data
 * from PouchDB, RxDB, Dexie, and Firestore to Pocket databases.
 *
 * ## Architecture
 *
 * ```
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │                        Source Database                               │
 * │              (PouchDB / RxDB / Dexie / Firestore)                   │
 * └───────────────────────────────┬─────────────────────────────────────┘
 *                                 │
 *                                 ▼
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │                       MigrationEngine                                │
 * │                                                                      │
 * │  ┌──────────────┐  ┌─────────────────┐  ┌───────────────────────┐  │
 * │  │   Adapter     │  │  Schema Mapper  │  │  Batch Processor      │  │
 * │  │  (per source) │  │  (auto-infer)   │  │  (configurable)       │  │
 * │  └──────────────┘  └─────────────────┘  └───────────────────────┘  │
 * │                                                                      │
 * │  ┌──────────────────────────────────────────────────────────────┐   │
 * │  │                   Progress Observable                         │   │
 * │  │  (RxJS Subject with phase, percent, collection tracking)      │   │
 * │  └──────────────────────────────────────────────────────────────┘   │
 * └───────────────────────────────┬─────────────────────────────────────┘
 *                                 │
 *                                 ▼
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │                        Pocket Database                               │
 * │                      (@pocket/core)                                  │
 * └─────────────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## Quick Start
 *
 * ```typescript
 * import { createMigrationEngine } from '@pocket/migration';
 *
 * // Migrate from PouchDB
 * const engine = createMigrationEngine({ source: 'pouchdb' });
 * engine.progress$.subscribe(p => console.log(`${p.percent}% complete`));
 *
 * const result = await engine.run(pouchDBExportData);
 * console.log(`Migrated ${result.migratedDocuments} documents`);
 * ```
 *
 * @packageDocumentation
 * @module @pocket/migration
 *
 * @see {@link MigrationEngine} for the main migration engine
 * @see {@link PouchDBAdapter} for PouchDB migration
 * @see {@link RxDBAdapter} for RxDB migration
 * @see {@link DexieAdapter} for Dexie migration
 * @see {@link FirestoreAdapter} for Firestore migration
 * @see {@link MigrationConfig} for configuration options
 */

// Types
export type {
  CollectionMapping,
  CollectionMigrationSummary,
  FieldMapping,
  MigrationConfig,
  MigrationError,
  MigrationPhase,
  MigrationProgress,
  MigrationResult,
  MigrationSource,
  SourceAnalysis,
  SourceDocument,
} from './types.js';

// Base Adapter
export { MigrationAdapter, type GetDocumentsOptions } from './adapters/base-adapter.js';

// PouchDB Adapter
export {
  PouchDBAdapter,
  createPouchDBAdapter,
  type PouchDBData,
} from './adapters/pouchdb-adapter.js';

// RxDB Adapter
export { RxDBAdapter, createRxDBAdapter, type RxDBData } from './adapters/rxdb-adapter.js';

// Dexie Adapter
export { DexieAdapter, createDexieAdapter, type DexieData } from './adapters/dexie-adapter.js';

// Firestore Adapter
export {
  FirestoreAdapter,
  createFirestoreAdapter,
  type FirestoreData,
} from './adapters/firestore-adapter.js';

// Migration Engine
export { MigrationEngine, createMigrationEngine } from './migration-engine.js';

// Schema Diff Analyzer
export {
  SchemaDiffAnalyzer,
  createSchemaDiffAnalyzer,
  type CollectionSchema,
  type FieldSchema,
  type IndexSchema,
  type MigrationPlan,
  type MigrationStep,
  type SchemaDefinition,
  type SchemaDiff,
  type SchemaDiffConfig,
  type SchemaDiffType,
} from './schema-diff.js';

// Migration Runner
export {
  MigrationRunner,
  createMigrationRunner,
  type DocumentProvider,
  type MigrationBackup,
  type MigrationRunConfig,
  type MigrationRunProgress,
  type MigrationRunResult,
  type MigrationRunStatus,
} from './migration-runner.js';
