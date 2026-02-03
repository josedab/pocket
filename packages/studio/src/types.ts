import type { Database } from '@pocket/core';

/**
 * Configuration options for the Pocket Studio server.
 *
 * @example
 * ```typescript
 * const config: StudioConfig = {
 *   port: 4680,
 *   host: 'localhost',
 *   database: myDatabase,
 *   readOnly: false,
 * };
 * ```
 */
export interface StudioConfig {
  /** Port to listen on. @default 4680 */
  port?: number;
  /** Host to bind to. @default 'localhost' */
  host?: string;
  /** Pocket Database instance to inspect */
  database?: Database;
  /** If true, disables all write operations. @default false */
  readOnly?: boolean;
  /** Optional basic authentication credentials */
  auth?: { username: string; password: string };
}

/**
 * Information about a collection including metadata and stats.
 */
export interface CollectionInfo {
  /** Collection name */
  name: string;
  /** Total number of documents in the collection */
  documentCount: number;
  /** Number of indexes on this collection */
  indexCount: number;
  /** Estimated storage size in bytes */
  storageSize: number;
  /** Timestamp of last modification (Unix ms) */
  lastModified: number;
  /** A sample document for schema inference */
  sampleDocument?: unknown;
}

/**
 * Result of a document query operation.
 */
export interface QueryResult {
  /** The documents matching the query */
  documents: unknown[];
  /** Total number of matching documents (before pagination) */
  totalCount: number;
  /** Time taken to execute the query in milliseconds */
  executionTimeMs: number;
  /** The query execution plan used */
  queryPlan?: StudioQueryPlan;
}

/**
 * Query execution plan for the studio.
 */
export interface StudioQueryPlan {
  /** Target collection */
  collection: string;
  /** Strategy used: full-scan, index-scan, or id-lookup */
  strategy: 'full-scan' | 'index-scan' | 'id-lookup';
  /** Name of index used, if applicable */
  indexUsed?: string;
  /** Estimated cost of the query */
  estimatedCost: number;
  /** Human-readable filter descriptions */
  filters: string[];
}

/**
 * Information about a sync engine's current state.
 */
export interface SyncInspection {
  /** Current sync status string */
  status: string;
  /** Timestamp of last successful sync, or null if never synced */
  lastSyncAt: number | null;
  /** Number of changes waiting to be pushed */
  pendingChanges: number;
  /** Number of unresolved conflicts */
  conflictCount: number;
  /** Number of connected peers */
  connectedPeers: number;
  /** Current sync checkpoint data */
  checkpoint: unknown;
}

/**
 * A single recorded performance profile entry.
 */
export interface PerformanceProfile {
  /** Operation type (e.g., 'query', 'insert', 'update', 'delete') */
  operation: string;
  /** Collection the operation targeted */
  collection: string;
  /** Duration of the operation in milliseconds */
  durationMs: number;
  /** Number of documents involved */
  documentCount: number;
  /** When the operation occurred (Unix ms) */
  timestamp: number;
}

/**
 * Index information for a collection.
 */
export interface IndexInfo {
  /** Index name */
  name: string;
  /** Fields included in the index */
  fields: string[];
  /** Whether the index enforces unique values */
  unique: boolean;
  /** Whether the index is sparse */
  sparse: boolean;
}

/**
 * A conflict entry found during sync inspection.
 */
export interface ConflictInfo {
  /** Document ID with the conflict */
  documentId: string;
  /** Collection containing the conflicted document */
  collection: string;
  /** When the conflict was detected (Unix ms) */
  detectedAt: number;
  /** The local version of the document */
  localVersion: unknown;
  /** The remote version of the document */
  remoteVersion: unknown;
}

/**
 * A single entry in the sync history log.
 */
export interface SyncHistoryEntry {
  /** Type of sync operation */
  type: 'push' | 'pull';
  /** When the sync occurred (Unix ms) */
  timestamp: number;
  /** Number of changes in this sync operation */
  changeCount: number;
  /** Whether the sync operation succeeded */
  success: boolean;
  /** Error message if the operation failed */
  error?: string;
}

/**
 * Options for the document editor.
 */
export interface DocumentEditorOptions {
  /** If true, all write operations throw an error */
  readOnly?: boolean;
}

/**
 * Events emitted by the studio system.
 */
export type StudioEvent =
  | { type: 'studio:started'; port: number }
  | { type: 'studio:stopped' }
  | { type: 'query:executed'; result: QueryResult }
  | { type: 'document:modified'; collection: string; id: string }
  | { type: 'query-playground:executed'; collection: string; durationMs: number; resultCount: number }
  | { type: 'query-playground:saved'; collection: string; queryId: string; name: string }
  | { type: 'devtools:attached'; globalName: string }
  | { type: 'error'; message: string };
