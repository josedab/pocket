import type { ChangeEvent, Document } from '@pocket/core';

/**
 * DevTools message types
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
 * Base message interface
 */
export interface DevToolsMessage {
  type: DevToolsMessageType;
  id: string;
  timestamp: number;
}

/**
 * Init message from page
 */
export interface InitMessage extends DevToolsMessage {
  type: 'init';
  version: string;
  databases: DatabaseInfo[];
}

/**
 * Database info
 */
export interface DatabaseInfo {
  name: string;
  version: number;
  nodeId: string;
  collections: string[];
  isOpen: boolean;
}

/**
 * Collection info
 */
export interface CollectionInfo {
  name: string;
  documentCount: number;
  indexes: IndexInfo[];
  schema?: SchemaInfo;
}

/**
 * Index info
 */
export interface IndexInfo {
  name: string;
  fields: string[];
  unique: boolean;
}

/**
 * Schema info
 */
export interface SchemaInfo {
  version: number;
  fields: Record<string, FieldInfo>;
}

/**
 * Field info
 */
export interface FieldInfo {
  type: string;
  required?: boolean;
  default?: unknown;
}

/**
 * Document list message
 */
export interface DocumentsMessage extends DevToolsMessage {
  type: 'documents';
  database: string;
  collection: string;
  documents: DocumentInfo[];
  total: number;
  offset: number;
  limit: number;
}

/**
 * Document info (summary for list)
 */
export interface DocumentInfo {
  _id: string;
  _rev?: string;
  _updatedAt?: number;
  _deleted?: boolean;
  preview: Record<string, unknown>;
}

/**
 * Single document message
 */
export interface DocumentMessage extends DevToolsMessage {
  type: 'document';
  database: string;
  collection: string;
  document: Document | null;
}

/**
 * Query message
 */
export interface QueryMessage extends DevToolsMessage {
  type: 'query';
  database: string;
  collection: string;
  spec: {
    filter?: Record<string, unknown>;
    sort?: Record<string, 'asc' | 'desc'>;
    limit?: number;
    skip?: number;
  };
}

/**
 * Query result message
 */
export interface QueryResultMessage extends DevToolsMessage {
  type: 'query';
  database: string;
  collection: string;
  results: Document[];
  executionTimeMs: number;
  explain?: QueryExplain;
}

/**
 * Query explain info
 */
export interface QueryExplain {
  indexUsed: string | null;
  documentsScanned: number;
  documentsReturned: number;
  filterApplied: boolean;
  sortApplied: boolean;
}

/**
 * Stats message
 */
export interface StatsMessage extends DevToolsMessage {
  type: 'stats';
  database: string;
  stats: DatabaseStats;
}

/**
 * Database stats
 */
export interface DatabaseStats {
  documentCount: number;
  storageSize: number;
  collectionCount: number;
  indexCount: number;
  collections: Record<string, CollectionStats>;
}

/**
 * Collection stats
 */
export interface CollectionStats {
  documentCount: number;
  avgDocumentSize: number;
  indexCount: number;
}

/**
 * Changes message (live feed)
 */
export interface ChangesMessage extends DevToolsMessage {
  type: 'changes';
  database: string;
  collection: string;
  changes: ChangeEvent<Document>[];
}

/**
 * Operation message (for history)
 */
export interface OperationMessage extends DevToolsMessage {
  type: 'operation';
  database: string;
  collection: string;
  operation: OperationRecord;
}

/**
 * Operation record
 */
export interface OperationRecord {
  id: string;
  type: 'insert' | 'update' | 'delete' | 'query' | 'get';
  collection: string;
  documentId?: string;
  timestamp: number;
  durationMs: number;
  success: boolean;
  error?: string;
  details?: Record<string, unknown>;
}

/**
 * Error message
 */
export interface ErrorMessage extends DevToolsMessage {
  type: 'error';
  error: string;
  code?: string;
  details?: Record<string, unknown>;
}

/**
 * DevTools state
 */
export interface DevToolsState {
  connected: boolean;
  databases: Map<string, DatabaseInfo>;
  selectedDatabase: string | null;
  selectedCollection: string | null;
  operations: OperationRecord[];
  changes: ChangeEvent<Document>[];
}

/**
 * DevTools configuration
 */
export interface DevToolsConfig {
  /** Maximum operations to keep in history */
  maxOperations?: number;
  /** Maximum changes to keep in feed */
  maxChanges?: number;
  /** Enable performance tracking */
  trackPerformance?: boolean;
  /** Enable query explain */
  explainQueries?: boolean;
  /** Auto-connect on init */
  autoConnect?: boolean;
}

/**
 * Time travel snapshot
 */
export interface TimeSnapshot {
  id: string;
  timestamp: number;
  database: string;
  collection: string;
  documents: Document[];
  label?: string;
}

/**
 * Performance metric
 */
export interface PerformanceMetric {
  operation: string;
  collection: string;
  durationMs: number;
  timestamp: number;
}
