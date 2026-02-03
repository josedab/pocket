/**
 * Types for the Pocket Migration Toolkit.
 *
 * This module defines configuration, result, and progress types
 * for migrating data from PouchDB, RxDB, Dexie, and Firestore to Pocket.
 *
 * @module types
 */

/**
 * Supported migration source databases.
 *
 * - `'pouchdb'`: CouchDB-compatible PouchDB database
 * - `'rxdb'`: RxDB reactive database with JSON Schema
 * - `'dexie'`: Dexie.js IndexedDB wrapper
 * - `'firestore'`: Google Cloud Firestore
 */
export type MigrationSource = 'pouchdb' | 'rxdb' | 'dexie' | 'firestore';

/**
 * Migration phase lifecycle states.
 *
 * - `'analyzing'`: Analyzing source database structure
 * - `'schema-mapping'`: Mapping source schema to Pocket schema
 * - `'migrating'`: Actively migrating documents
 * - `'validating'`: Validating migrated data
 * - `'complete'`: Migration finished
 */
export type MigrationPhase =
  | 'analyzing'
  | 'schema-mapping'
  | 'migrating'
  | 'validating'
  | 'complete';

/**
 * Configuration for a migration run.
 *
 * @example Minimal configuration
 * ```typescript
 * const config: MigrationConfig = {
 *   source: 'pouchdb'
 * };
 * ```
 *
 * @example Full configuration
 * ```typescript
 * const config: MigrationConfig = {
 *   source: 'firestore',
 *   batchSize: 200,
 *   dryRun: false,
 *   onProgress: (progress) => console.log(`${progress.percent}% complete`),
 *   transformDocument: (doc) => ({ ...doc, migratedAt: Date.now() }),
 *   skipCollections: ['_system'],
 *   includeCollections: ['users', 'posts']
 * };
 * ```
 *
 * @see {@link MigrationEngine}
 */
export interface MigrationConfig {
  /** Source database type to migrate from */
  source: MigrationSource;

  /**
   * Number of documents to process per batch.
   * @default 100
   */
  batchSize?: number;

  /**
   * When true, simulates migration without writing data.
   * @default false
   */
  dryRun?: boolean;

  /**
   * Callback invoked on migration progress updates.
   * Called once per batch or phase change.
   */
  onProgress?: (progress: MigrationProgress) => void;

  /**
   * Optional transform applied to each document before writing.
   * Return the transformed document or `null` to skip it.
   */
  transformDocument?: (doc: SourceDocument) => SourceDocument | null;

  /**
   * Collection names to skip during migration.
   * Takes precedence over `includeCollections`.
   */
  skipCollections?: string[];

  /**
   * Collection names to include in migration.
   * When specified, only these collections are migrated.
   */
  includeCollections?: string[];
}

/**
 * Result summary of a completed migration.
 *
 * @see {@link MigrationEngine.run}
 */
export interface MigrationResult {
  /** Total number of documents found in source */
  totalDocuments: number;

  /** Number of documents successfully migrated */
  migratedDocuments: number;

  /** Number of documents that failed to migrate */
  failedDocuments: number;

  /** Number of documents skipped (filtered or transformed to null) */
  skippedDocuments: number;

  /** Errors encountered during migration */
  errors: MigrationError[];

  /** Total migration duration in milliseconds */
  duration: number;

  /** Per-collection migration summaries */
  collections: Record<string, CollectionMigrationSummary>;
}

/**
 * Per-collection migration summary.
 *
 * @see {@link MigrationResult.collections}
 */
export interface CollectionMigrationSummary {
  /** Source collection name */
  sourceCollection: string;

  /** Target Pocket collection name */
  targetCollection: string;

  /** Number of documents migrated for this collection */
  documentCount: number;

  /** Number of documents that failed for this collection */
  failedCount: number;

  /** Number of documents skipped for this collection */
  skippedCount: number;
}

/**
 * Real-time progress information during migration.
 *
 * @see {@link MigrationConfig.onProgress}
 * @see {@link MigrationEngine.progress$}
 */
export interface MigrationProgress {
  /** Current migration phase */
  phase: MigrationPhase;

  /** Current collection being processed, if applicable */
  collection?: string;

  /** Number of documents processed so far */
  current: number;

  /** Total number of documents to process */
  total: number;

  /** Completion percentage (0-100) */
  percent: number;
}

/**
 * Mapping definition between a source collection and a Pocket collection.
 *
 * @see {@link MigrationAdapter.getSchema}
 */
export interface CollectionMapping {
  /** Source collection name */
  sourceCollection: string;

  /** Target Pocket collection name */
  targetCollection: string;

  /** Field-level mappings from source to target */
  fieldMappings: FieldMapping[];

  /** Optional per-collection transforms applied after field mapping */
  transforms?: ((doc: Record<string, unknown>) => Record<string, unknown>)[];
}

/**
 * Mapping definition for a single field between source and target schemas.
 *
 * @see {@link CollectionMapping.fieldMappings}
 */
export interface FieldMapping {
  /** Field name in the source document */
  sourceField: string;

  /** Field name in the target Pocket document */
  targetField: string;

  /** Pocket field type (e.g. 'string', 'number', 'boolean', 'object', 'array') */
  type: string;

  /** Default value when the source field is missing */
  defaultValue?: unknown;

  /** Optional transform for this specific field */
  transform?: (value: unknown) => unknown;
}

/**
 * A document from the source database with required `_id` field.
 *
 * @see {@link MigrationConfig.transformDocument}
 */
export interface SourceDocument extends Record<string, unknown> {
  /** Document identifier from the source database */
  _id: string;

  /** Optional metadata from the source database */
  _meta?: Record<string, unknown>;
}

/**
 * Error encountered during migration of a specific document.
 *
 * @see {@link MigrationResult.errors}
 */
export interface MigrationError {
  /** Collection where the error occurred */
  collection: string;

  /** Document ID that caused the error, if available */
  documentId?: string;

  /** Error message */
  error: string;

  /** Migration phase when the error occurred */
  phase: MigrationPhase;
}

/**
 * Analysis result from inspecting a source database.
 *
 * @see {@link MigrationAdapter.analyze}
 * @see {@link MigrationEngine.analyze}
 */
export interface SourceAnalysis {
  /** Collection names found in the source */
  collections: string[];

  /** Total number of documents across all collections */
  totalDocuments: number;

  /** Estimated size in bytes of all source data */
  estimatedSizeBytes: number;
}
