/**
 * Type definitions for @pocket/studio-pro.
 *
 * @module @pocket/studio-pro
 */

/**
 * Describes a single field in a collection schema.
 *
 * @example
 * ```typescript
 * const field: SchemaField = {
 *   name: 'email',
 *   type: 'string',
 *   required: true,
 *   indexed: true,
 * };
 * ```
 */
export interface SchemaField {
  /** Field name */
  name: string;
  /** Data type (e.g., 'string', 'number', 'boolean', 'object', 'array') */
  type: string;
  /** Whether the field is required on every document */
  required: boolean;
  /** Default value for the field, if any */
  default?: unknown;
  /** Human-readable description */
  description?: string;
  /** Whether the field is indexed */
  indexed: boolean;
}

/**
 * Schema definition for a collection.
 *
 * @example
 * ```typescript
 * const schema: CollectionSchema = {
 *   name: 'users',
 *   fields: [{ name: 'email', type: 'string', required: true, indexed: true }],
 *   primaryKey: '_id',
 *   indexes: ['email'],
 *   timestamps: true,
 * };
 * ```
 */
export interface CollectionSchema {
  /** Collection name */
  name: string;
  /** Fields in the collection */
  fields: SchemaField[];
  /** Primary key field name */
  primaryKey: string;
  /** Index names */
  indexes: string[];
  /** Whether the collection has timestamp fields */
  timestamps: boolean;
}

/**
 * State for the visual schema designer.
 */
export interface SchemaDesignerState {
  /** All known collection schemas */
  collections: CollectionSchema[];
  /** Currently selected collection name */
  selectedCollection: string | null;
  /** Whether unsaved changes exist */
  dirty: boolean;
  /** Current validation errors */
  validationErrors: SchemaValidationError[];
}

/**
 * State for the query playground.
 */
export interface QueryPlaygroundState {
  /** Current query string */
  query: string;
  /** Latest results */
  results: unknown[];
  /** Execution time of last query in ms */
  executionTime: number;
  /** Error message from last execution, if any */
  error: string | null;
  /** Query execution history */
  history: QueryHistoryEntry[];
}

/**
 * A single entry in the query history log.
 */
export interface QueryHistoryEntry {
  /** Unique identifier */
  id: string;
  /** The query that was executed */
  query: string;
  /** When the query was executed (ISO timestamp) */
  executedAt: string;
  /** Number of results returned */
  resultCount: number;
  /** Execution time in milliseconds */
  executionMs: number;
}

/**
 * Live state for the sync dashboard.
 */
export interface SyncDashboardState {
  /** Whether the sync engine is connected */
  connected: boolean;
  /** Connected peers */
  peers: SyncPeerInfo[];
  /** Recent sync history entries */
  syncHistory: SyncHistoryEntry[];
  /** Current throughput metrics */
  throughput: { docsPerSecond: number; bytesPerSecond: number };
  /** Unresolved conflicts */
  conflicts: SyncConflict[];
}

/**
 * Information about a sync peer.
 */
export interface SyncPeerInfo {
  /** Unique peer identifier */
  peerId: string;
  /** Connection status */
  status: 'connected' | 'disconnected' | 'syncing';
  /** When the peer last synced (ISO timestamp) */
  lastSyncAt: string | null;
  /** Number of documents synced with this peer */
  docsSynced: number;
  /** Network latency in milliseconds */
  latencyMs: number;
}

/**
 * A single entry in the sync history log.
 */
export interface SyncHistoryEntry {
  /** Unique identifier */
  id: string;
  /** When the sync occurred (ISO timestamp) */
  timestamp: string;
  /** Direction of sync */
  direction: 'push' | 'pull' | 'bidirectional';
  /** Number of documents transferred */
  documentCount: number;
  /** Number of conflicts encountered */
  conflictCount: number;
  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * A sync conflict record.
 */
export interface SyncConflict {
  /** Document ID */
  documentId: string;
  /** Collection name */
  collection: string;
  /** When the conflict was detected (ISO timestamp) */
  detectedAt: string;
}

/**
 * Configuration for the Studio Pro module.
 *
 * @example
 * ```typescript
 * const config: StudioConfig = {
 *   enableSchemaEditor: true,
 *   enableQueryPlayground: true,
 *   enableSyncDashboard: true,
 *   maxHistoryEntries: 100,
 * };
 * ```
 */
export interface StudioConfig {
  /** Enable the schema editor panel */
  enableSchemaEditor: boolean;
  /** Enable the query playground panel */
  enableQueryPlayground: boolean;
  /** Enable the sync dashboard panel */
  enableSyncDashboard: boolean;
  /** Maximum number of history entries to retain */
  maxHistoryEntries: number;
}

/**
 * A schema validation error.
 */
export interface SchemaValidationError {
  /** Collection the error relates to */
  collection: string;
  /** Field the error relates to, if applicable */
  field: string | null;
  /** Human-readable error message */
  message: string;
  /** Severity level */
  severity: 'error' | 'warning' | 'info';
}

/**
 * State for the data inspector panel.
 */
export interface DataInspectorState {
  /** Collection being inspected */
  collection: string;
  /** Documents on the current page */
  documents: unknown[];
  /** Current page number (0-based) */
  page: number;
  /** Page size */
  pageSize: number;
  /** Total document count in the collection */
  totalCount: number;
  /** Field to sort by */
  sortField: string | null;
  /** Sort direction */
  sortDirection: 'asc' | 'desc';
}

/**
 * Describes a difference between two schemas.
 */
export interface SchemaDiff {
  /** Type of change */
  type: 'added' | 'removed' | 'changed';
  /** Field name that changed */
  field: string;
  /** Description of the change */
  description: string;
}

/**
 * Execution plan analysis for a query.
 */
export interface QueryExplanation {
  /** The original query */
  query: string;
  /** Strategy used */
  strategy: 'full-scan' | 'index-scan' | 'id-lookup';
  /** Estimated cost (arbitrary units) */
  estimatedCost: number;
  /** Index used, if any */
  indexUsed: string | null;
  /** Human-readable notes */
  notes: string[];
}

/**
 * Collection statistics returned by the data inspector.
 */
export interface CollectionStats {
  /** Total document count */
  count: number;
  /** Average document size in bytes (estimated) */
  avgDocSize: number;
  /** Field names present in the collection */
  fields: string[];
}
