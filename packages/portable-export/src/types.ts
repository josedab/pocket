// ---- Export Format ----

export type ExportFormat = 'json' | 'csv' | 'sql' | 'ndjson';

// ---- Export Configuration ----

export interface ExportConfig {
  format: ExportFormat;
  collections?: string[];
  includeMetadata?: boolean;
  prettyPrint?: boolean;
  delimiter?: string;
}

// ---- Import Configuration ----

export interface ImportConfig {
  format: ExportFormat;
  mergeStrategy?: 'replace' | 'merge' | 'skip';
  validateSchema?: boolean;
}

// ---- Export Result ----

export interface ExportResult {
  data: string;
  format: ExportFormat;
  collectionCount: number;
  documentCount: number;
  exportedAt: string;
  sizeBytes: number;
  checksum: string;
}

// ---- Import Result ----

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: ImportError[];
  collections: string[];
}

// ---- Import Error ----

export interface ImportError {
  collection: string;
  documentId?: string;
  message: string;
  line?: number;
}

// ---- Export Progress ----

export interface ExportProgress {
  phase: 'preparing' | 'exporting' | 'finalizing';
  current: number;
  total: number;
  collection?: string;
}

// ---- Collection Export ----

export interface CollectionExport {
  name: string;
  documents: Record<string, unknown>[];
  schema?: object;
}

// ---- Database Snapshot ----

export interface DatabaseSnapshot {
  version: string;
  exportedAt: string;
  collections: CollectionExport[];
  metadata?: Record<string, unknown>;
}

// ---- Data Integrity ----

export interface DataIntegrity {
  checksum: string;
  documentCount: number;
  valid: boolean;
}
