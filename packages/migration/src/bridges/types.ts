/**
 * Types for competitor migration bridges.
 *
 * Defines configuration, progress, result, and inspection types
 * for bridging data from RxDB, PouchDB, Dexie, and WatermelonDB
 * into Pocket databases.
 *
 * @module bridges/types
 */

/** Source database types */
export type CompetitorDB = 'rxdb' | 'pouchdb' | 'dexie' | 'watermelondb';

/** Bridge migration configuration */
export interface BridgeMigrationConfig {
  source: CompetitorDB;
  sourcePath?: string;
  sourceConfig?: Record<string, unknown>;
  targetCollections?: string[];
  batchSize?: number;
  transformDocument?: (doc: Record<string, unknown>, collection: string) => Record<string, unknown> | null;
  onProgress?: (progress: BridgeMigrationProgress) => void;
  dryRun?: boolean;
  includeAttachments?: boolean;
  includeIndexes?: boolean;
  preserveIds?: boolean;
}

export interface BridgeMigrationProgress {
  phase: 'scanning' | 'migrating' | 'verifying' | 'complete';
  collection: string;
  total: number;
  processed: number;
  failed: number;
  percentage: number;
  estimatedRemainingMs: number;
}

export interface BridgeMigrationResult {
  source: CompetitorDB;
  success: boolean;
  collections: CollectionMigrationResult[];
  totalDocuments: number;
  migratedDocuments: number;
  failedDocuments: number;
  skippedDocuments: number;
  duration: number;
  warnings: string[];
  errors: Array<{ collection: string; documentId?: string; error: string }>;
}

export interface CollectionMigrationResult {
  name: string;
  documentCount: number;
  migratedCount: number;
  failedCount: number;
  indexesMigrated: number;
  attachmentsMigrated: number;
  duration: number;
}

/** Schema mapping for competitor databases */
export interface SchemaMapping {
  sourceField: string;
  targetField: string;
  transform?: (value: unknown) => unknown;
}

/** Competitor database inspector result */
export interface DatabaseInspection {
  source: CompetitorDB;
  collections: Array<{
    name: string;
    documentCount: number;
    indexes: string[];
    sampleDocument?: Record<string, unknown>;
    estimatedSize: number;
  }>;
  totalDocuments: number;
  totalSize: number;
  version?: string;
}
