import type { Document } from '../types/document.js';

/**
 * Migration direction
 */
export type MigrationDirection = 'up' | 'down';

/**
 * Migration context passed to migration functions
 */
export interface MigrationContext {
  /** Database name */
  databaseName: string;
  /** Collection name being migrated */
  collectionName: string;
  /** Source schema version */
  fromVersion: number;
  /** Target schema version */
  toVersion: number;
  /** Migration direction */
  direction: MigrationDirection;
}

/**
 * Document migration function - transforms a single document
 */
export type DocumentMigrator<TFrom = unknown, TTo = unknown> = (
  doc: TFrom,
  context: MigrationContext
) => TTo | Promise<TTo>;

/**
 * Migration definition for a single version step
 */
export interface Migration<TFrom = unknown, TTo = unknown> {
  /** Version this migration upgrades to */
  version: number;
  /** Optional migration name for identification */
  name?: string;
  /** Upgrade function (previous version -> this version) */
  up: DocumentMigrator<TFrom, TTo>;
  /** Downgrade function (this version -> previous version) */
  down?: DocumentMigrator<TTo, TFrom>;
}

/**
 * Migration result for a single document
 */
export interface DocumentMigrationResult {
  /** Document ID */
  documentId: string;
  /** Whether migration succeeded */
  success: boolean;
  /** Error if migration failed */
  error?: Error;
  /** Old version */
  fromVersion: number;
  /** New version */
  toVersion: number;
}

/**
 * Migration batch result
 */
export interface MigrationResult {
  /** Collection that was migrated */
  collectionName: string;
  /** Starting version */
  fromVersion: number;
  /** Ending version */
  toVersion: number;
  /** Total documents processed */
  totalDocuments: number;
  /** Successfully migrated documents */
  successCount: number;
  /** Failed migrations */
  failureCount: number;
  /** Individual failures */
  failures: DocumentMigrationResult[];
  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * Migration strategy for handling failures
 */
export type MigrationStrategy = 'stop-on-error' | 'continue-on-error' | 'rollback-on-error';

/**
 * Migration options
 */
export interface MigrationOptions {
  /** Strategy for handling failures */
  strategy?: MigrationStrategy;
  /** Batch size for processing documents */
  batchSize?: number;
  /** Whether to run migrations lazily (on document access) */
  lazy?: boolean;
  /** Progress callback */
  onProgress?: (progress: MigrationProgress) => void;
}

/**
 * Migration progress information
 */
export interface MigrationProgress {
  /** Collection being migrated */
  collectionName: string;
  /** Current document index (1-based) */
  current: number;
  /** Total documents to migrate */
  total: number;
  /** Percentage complete */
  percentage: number;
  /** Current phase */
  phase: 'reading' | 'migrating' | 'writing' | 'complete';
}

/**
 * Schema version metadata stored with documents
 */
export interface SchemaVersionMetadata {
  /** Current schema version */
  _schemaVersion?: number;
}

/**
 * Document with schema version
 */
export type VersionedDocument<T extends Document = Document> = T & SchemaVersionMetadata;

/**
 * Migration registry entry
 */
export interface MigrationRegistryEntry {
  /** Collection name */
  collectionName: string;
  /** Migrations in order */
  migrations: Migration[];
  /** Current target version */
  currentVersion: number;
}

/**
 * Migration state stored in database
 */
export interface MigrationState {
  /** Collection name */
  collectionName: string;
  /** Current schema version */
  currentVersion: number;
  /** Last migration timestamp */
  lastMigrationAt: number;
  /** Pending lazy migrations count */
  pendingLazyMigrations: number;
}
