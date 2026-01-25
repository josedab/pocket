import type { ChangeEvent, Document } from '@pocket/core';

/**
 * Message types for DevTools communication protocol.
 *
 * Defines the types of messages exchanged between the page
 * and the DevTools extension.
 */
export type DevToolsMessageType =
  | 'init'
  | 'databases'
  | 'collections'
  | 'documents'
  | 'document'
  | 'query'
  | 'stats'
  | 'changes'
  | 'operation'
  | 'error'
  | 'ping'
  | 'pong';

/**
 * Base interface for all DevTools messages.
 *
 * All messages include a unique ID and timestamp for tracking
 * and correlation.
 */
export interface DevToolsMessage {
  /** Message type identifier */
  type: DevToolsMessageType;
  /** Unique message ID */
  id: string;
  /** Unix timestamp of message creation */
  timestamp: number;
}

/**
 * Initialization message sent when connecting to DevTools.
 *
 * Contains the Pocket version and list of registered databases.
 */
export interface InitMessage extends DevToolsMessage {
  type: 'init';
  /** Pocket library version */
  version: string;
  /** List of registered databases */
  databases: DatabaseInfo[];
}

/**
 * Information about a registered database.
 *
 * Provides metadata about a database for display in DevTools.
 */
export interface DatabaseInfo {
  /** Database name */
  name: string;
  /** Database schema version */
  version: number;
  /** Node ID for this database instance */
  nodeId: string;
  /** List of collection names */
  collections: string[];
  /** Whether the database is currently open */
  isOpen: boolean;
}

/**
 * Information about a collection for DevTools display.
 */
export interface CollectionInfo {
  /** Collection name */
  name: string;
  /** Number of documents in the collection */
  documentCount: number;
  /** List of indexes on the collection */
  indexes: IndexInfo[];
  /** Schema information if defined */
  schema?: SchemaInfo;
}

/**
 * Information about an index on a collection.
 */
export interface IndexInfo {
  /** Index name */
  name: string;
  /** Fields included in the index */
  fields: string[];
  /** Whether the index enforces uniqueness */
  unique: boolean;
}

/**
 * Schema information for a collection.
 */
export interface SchemaInfo {
  /** Schema version number */
  version: number;
  /** Field definitions */
  fields: Record<string, FieldInfo>;
}

/**
 * Information about a field in a schema.
 */
export interface FieldInfo {
  /** Field type (e.g., 'string', 'number') */
  type: string;
  /** Whether the field is required */
  required?: boolean;
  /** Default value if not provided */
  default?: unknown;
}

/**
 * Message containing a paginated list of documents.
 */
export interface DocumentsMessage extends DevToolsMessage {
  type: 'documents';
  /** Database name */
  database: string;
  /** Collection name */
  collection: string;
  /** List of document summaries */
  documents: DocumentInfo[];
  /** Total number of matching documents */
  total: number;
  /** Pagination offset */
  offset: number;
  /** Page size limit */
  limit: number;
}

/**
 * Document summary for list display.
 *
 * Contains essential metadata and a preview of the document content.
 */
export interface DocumentInfo {
  /** Document ID */
  _id: string;
  /** Document revision */
  _rev?: string;
  /** Last update timestamp */
  _updatedAt?: number;
  /** Whether the document is deleted */
  _deleted?: boolean;
  /** Preview of document fields (truncated for display) */
  preview: Record<string, unknown>;
}

/**
 * Message containing a single document.
 */
export interface DocumentMessage extends DevToolsMessage {
  type: 'document';
  /** Database name */
  database: string;
  /** Collection name */
  collection: string;
  /** Full document, or null if not found */
  document: Document | null;
}

/**
 * Query request message.
 */
export interface QueryMessage extends DevToolsMessage {
  type: 'query';
  /** Database name */
  database: string;
  /** Collection name */
  collection: string;
  /** Query specification */
  spec: {
    /** Filter criteria */
    filter?: Record<string, unknown>;
    /** Sort order by field */
    sort?: Record<string, 'asc' | 'desc'>;
    /** Maximum results to return */
    limit?: number;
    /** Number of results to skip */
    skip?: number;
  };
}

/**
 * Query result message with timing information.
 */
export interface QueryResultMessage extends DevToolsMessage {
  type: 'query';
  /** Database name */
  database: string;
  /** Collection name */
  collection: string;
  /** Query results */
  results: Document[];
  /** Query execution time in milliseconds */
  executionTimeMs: number;
  /** Query plan explanation */
  explain?: QueryExplain;
}

/**
 * Query execution plan explanation.
 *
 * Provides information about how a query was executed
 * for debugging and optimization.
 */
export interface QueryExplain {
  /** Name of index used, or null if full scan */
  indexUsed: string | null;
  /** Number of documents scanned */
  documentsScanned: number;
  /** Number of documents returned */
  documentsReturned: number;
  /** Whether a filter was applied */
  filterApplied: boolean;
  /** Whether sorting was applied */
  sortApplied: boolean;
}

/**
 * Database statistics message.
 */
export interface StatsMessage extends DevToolsMessage {
  type: 'stats';
  /** Database name */
  database: string;
  /** Statistics for the database */
  stats: DatabaseStats;
}

/**
 * Aggregate statistics for a database.
 */
export interface DatabaseStats {
  /** Total documents across all collections */
  documentCount: number;
  /** Storage size in bytes */
  storageSize: number;
  /** Number of collections */
  collectionCount: number;
  /** Total number of indexes */
  indexCount: number;
  /** Per-collection statistics */
  collections: Record<string, CollectionStats>;
}

/**
 * Statistics for a single collection.
 */
export interface CollectionStats {
  /** Number of documents in the collection */
  documentCount: number;
  /** Average document size in bytes */
  avgDocumentSize: number;
  /** Number of indexes on the collection */
  indexCount: number;
}

/**
 * Live changes feed message.
 *
 * Contains real-time changes from the database.
 */
export interface ChangesMessage extends DevToolsMessage {
  type: 'changes';
  /** Database name */
  database: string;
  /** Collection name */
  collection: string;
  /** List of change events */
  changes: ChangeEvent<Document>[];
}

/**
 * Operation history message.
 */
export interface OperationMessage extends DevToolsMessage {
  type: 'operation';
  /** Database name */
  database: string;
  /** Collection name */
  collection: string;
  /** Operation details */
  operation: OperationRecord;
}

/**
 * Record of a database operation for history tracking.
 *
 * Used to display operation history and performance metrics
 * in the DevTools panel.
 */
export interface OperationRecord {
  /** Unique operation ID */
  id: string;
  /** Operation type */
  type: 'insert' | 'update' | 'delete' | 'query' | 'get';
  /** Collection the operation was performed on */
  collection: string;
  /** Document ID if applicable */
  documentId?: string;
  /** When the operation occurred */
  timestamp: number;
  /** Operation duration in milliseconds */
  durationMs: number;
  /** Whether the operation succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Additional operation details */
  details?: Record<string, unknown>;
}

/**
 * Error message from DevTools.
 */
export interface ErrorMessage extends DevToolsMessage {
  type: 'error';
  /** Error message */
  error: string;
  /** Error code */
  code?: string;
  /** Additional error details */
  details?: Record<string, unknown>;
}

/**
 * Current state of the DevTools panel.
 */
export interface DevToolsState {
  /** Whether connected to the page */
  connected: boolean;
  /** Registered databases */
  databases: Map<string, DatabaseInfo>;
  /** Currently selected database */
  selectedDatabase: string | null;
  /** Currently selected collection */
  selectedCollection: string | null;
  /** Recent operations history */
  operations: OperationRecord[];
  /** Recent changes feed */
  changes: ChangeEvent<Document>[];
}

/**
 * Configuration options for DevTools.
 *
 * @example
 * ```typescript
 * const config: DevToolsConfig = {
 *   maxOperations: 500,
 *   trackPerformance: true,
 *   autoConnect: true,
 * };
 *
 * initDevTools(database, config);
 * ```
 */
export interface DevToolsConfig {
  /**
   * Maximum operations to keep in history.
   * @default 1000
   */
  maxOperations?: number;
  /**
   * Maximum changes to keep in the live feed.
   * @default 500
   */
  maxChanges?: number;
  /**
   * Enable performance metrics tracking.
   * @default true
   */
  trackPerformance?: boolean;
  /**
   * Enable query execution plan explanation.
   * @default true
   */
  explainQueries?: boolean;
  /**
   * Auto-connect to DevTools extension on initialization.
   * @default true
   */
  autoConnect?: boolean;
}

/**
 * Point-in-time snapshot for time-travel debugging.
 *
 * Captures the state of a collection at a specific moment,
 * allowing restoration for debugging purposes.
 *
 * @example
 * ```typescript
 * // Create a snapshot before making changes
 * const snapshot = await inspector.createSnapshot('mydb', 'users', 'Before migration');
 *
 * // Make changes...
 *
 * // Restore if something went wrong
 * await inspector.restoreSnapshot(snapshot.id);
 * ```
 */
export interface TimeSnapshot {
  /** Unique snapshot ID */
  id: string;
  /** When the snapshot was taken */
  timestamp: number;
  /** Database name */
  database: string;
  /** Collection name */
  collection: string;
  /** Captured documents */
  documents: Document[];
  /** Optional descriptive label */
  label?: string;
}

/**
 * Performance metric for a database operation.
 *
 * Used for performance monitoring and analysis.
 */
export interface PerformanceMetric {
  /** Operation type (e.g., 'query', 'insert') */
  operation: string;
  /** Collection the operation was performed on */
  collection: string;
  /** Operation duration in milliseconds */
  durationMs: number;
  /** When the operation occurred */
  timestamp: number;
}
