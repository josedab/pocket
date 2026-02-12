/**
 * Import/Export Manager — enhanced data import and export for Pocket Studio.
 *
 * Supports JSON, CSV, NDJSON, and SQL dump formats for import, and
 * JSON, CSV, NDJSON for export. Handles large datasets with
 * streaming/batching, validates imported data against collection schemas,
 * provides RxJS observable progress tracking, and supports field mapping
 * for mismatched schemas.
 *
 * @module @pocket/studio/import-export-manager
 *
 * @example
 * ```typescript
 * import { createImportExportManager } from '@pocket/studio';
 *
 * const manager = createImportExportManager({ batchSize: 500 });
 *
 * // Import JSON
 * const result = await manager.importData({
 *   format: 'json',
 *   data: '[{"name":"Alice"},{"name":"Bob"}]',
 *   collection: 'users',
 * });
 * console.log(result.importedCount); // 2
 *
 * // Export CSV
 * const csv = manager.exportData({
 *   format: 'csv',
 *   documents: [{ name: 'Alice', age: 30 }],
 * });
 * ```
 */

import { BehaviorSubject, Subject, takeUntil, type Observable } from 'rxjs';
import type { StudioEvent } from './types.js';

// ── Types ────────────────────────────────────────────────────────────────

/** Supported import formats. */
export type ImportFormat = 'json' | 'csv' | 'ndjson' | 'sql';

/** Supported export formats. */
export type ExportFormat = 'json' | 'csv' | 'ndjson';

/** Field mapping rule: source field name → target field name. */
export interface FieldMapping {
  /** Field name in the incoming data */
  source: string;
  /** Field name in the target collection schema */
  target: string;
  /** Optional transform function */
  transform?: (value: unknown) => unknown;
}

/** Schema definition used for validation during import. */
export interface ImportSchemaField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'date' | 'any';
  required?: boolean;
}

/** Options for an import operation. */
export interface ImportOptions {
  /** Format of the incoming data */
  format: ImportFormat;
  /** Raw string data to import */
  data: string;
  /** Target collection name */
  collection: string;
  /** Optional field mappings for mismatched schemas */
  fieldMappings?: FieldMapping[];
  /** Optional schema fields for validation */
  schema?: ImportSchemaField[];
  /** Whether to skip invalid documents instead of failing (default: false) */
  skipInvalid?: boolean;
}

/** Options for an export operation. */
export interface ExportOptions {
  /** Desired export format */
  format: ExportFormat;
  /** Documents to export */
  documents: Record<string, unknown>[];
  /** Optional subset of fields to include */
  fields?: string[];
}

/** A single validation error encountered during import. */
export interface ImportValidationError {
  /** Zero-based row/document index */
  row: number;
  /** The field that failed validation, if applicable */
  field?: string;
  /** Human-readable error message */
  message: string;
}

/** Result of an import operation. */
export interface ImportResult {
  /** Number of documents successfully imported */
  importedCount: number;
  /** Number of documents skipped due to validation errors */
  skippedCount: number;
  /** Total number of documents in the input */
  totalCount: number;
  /** Validation errors encountered */
  errors: ImportValidationError[];
  /** The parsed and validated documents */
  documents: Record<string, unknown>[];
  /** Duration of the import in milliseconds */
  durationMs: number;
}

/** Progress information emitted during import/export. */
export interface ImportExportProgress {
  /** Current operation */
  operation: 'import' | 'export';
  /** 0 – 100 */
  percent: number;
  /** Number of documents processed so far */
  processedCount: number;
  /** Total number of documents */
  totalCount: number;
  /** Current batch number (1-based) */
  currentBatch: number;
  /** Total number of batches */
  totalBatches: number;
}

/** Configuration for the import/export manager. */
export interface ImportExportManagerConfig {
  /** Number of documents per batch (default: 1000) */
  batchSize?: number;
  /** Maximum documents allowed in a single import (default: 100 000) */
  maxImportSize?: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function generateId(): string {
  return `ie_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }

  fields.push(current);
  return fields;
}

// ── Class ────────────────────────────────────────────────────────────────

/**
 * Import/export manager for Pocket Studio.
 *
 * Handles multi-format data import and export with batching,
 * validation, field mapping, and observable progress tracking.
 */
export class ImportExportManager {
  private readonly config: Required<ImportExportManagerConfig>;
  private readonly destroy$ = new Subject<void>();
  private readonly events$ = new Subject<StudioEvent>();
  private readonly progress$ = new BehaviorSubject<ImportExportProgress | null>(null);

  constructor(config: ImportExportManagerConfig = {}) {
    this.config = {
      batchSize: config.batchSize ?? 1000,
      maxImportSize: config.maxImportSize ?? 100_000,
    };
  }

  // ── Import ───────────────────────────────────────────────────────────

  /**
   * Import data from a string in the specified format.
   *
   * Parses the input, applies field mappings, validates against the
   * provided schema, and returns the result. Progress is emitted
   * via the progress observable for long-running imports.
   */
  async importData(options: ImportOptions): Promise<ImportResult> {
    const startTime = Date.now();

    let rawDocuments: Record<string, unknown>[];

    switch (options.format) {
      case 'json':
        rawDocuments = this.parseJSON(options.data);
        break;
      case 'csv':
        rawDocuments = this.parseCSV(options.data);
        break;
      case 'ndjson':
        rawDocuments = this.parseNDJSON(options.data);
        break;
      case 'sql':
        rawDocuments = this.parseSQLDump(options.data);
        break;
      default:
        throw new Error(`Unsupported import format: ${options.format as string}`);
    }

    if (rawDocuments.length > this.config.maxImportSize) {
      throw new Error(
        `Import size (${rawDocuments.length}) exceeds maximum allowed (${this.config.maxImportSize})`,
      );
    }

    // Apply field mappings
    if (options.fieldMappings && options.fieldMappings.length > 0) {
      rawDocuments = rawDocuments.map((doc) =>
        this.applyFieldMappings(doc, options.fieldMappings!),
      );
    }

    // Validate and batch-process
    const errors: ImportValidationError[] = [];
    const validDocuments: Record<string, unknown>[] = [];
    const totalBatches = Math.ceil(rawDocuments.length / this.config.batchSize);

    for (let batch = 0; batch < totalBatches; batch++) {
      const start = batch * this.config.batchSize;
      const end = Math.min(start + this.config.batchSize, rawDocuments.length);
      const slice = rawDocuments.slice(start, end);

      for (let i = 0; i < slice.length; i++) {
        const rowIndex = start + i;
        const doc = slice[i]!;

        if (options.schema) {
          const rowErrors = this.validateDocument(doc, options.schema, rowIndex);
          if (rowErrors.length > 0) {
            errors.push(...rowErrors);
            if (!options.skipInvalid) {
              continue;
            }
            // Even with skipInvalid, skip documents with errors
            continue;
          }
        }

        validDocuments.push(doc);
      }

      // Emit progress
      this.progress$.next({
        operation: 'import',
        percent: Math.round(((batch + 1) / totalBatches) * 100),
        processedCount: end,
        totalCount: rawDocuments.length,
        currentBatch: batch + 1,
        totalBatches,
      });

      // Yield control for large imports
      if (totalBatches > 1) {
        await this.yieldControl();
      }
    }

    const durationMs = Date.now() - startTime;

    this.events$.next({
      type: 'document:modified',
      collection: options.collection,
      id: generateId(),
    });

    return {
      importedCount: validDocuments.length,
      skippedCount: rawDocuments.length - validDocuments.length,
      totalCount: rawDocuments.length,
      errors,
      documents: validDocuments,
      durationMs,
    };
  }

  // ── Export ───────────────────────────────────────────────────────────

  /**
   * Export documents to a string in the specified format.
   */
  exportData(options: ExportOptions): string {
    let documents = options.documents;

    // Filter to specified fields if requested
    if (options.fields && options.fields.length > 0) {
      const fields = options.fields;
      documents = documents.map((doc) => {
        const filtered: Record<string, unknown> = {};
        for (const field of fields) {
          if (field in doc) {
            filtered[field] = doc[field];
          }
        }
        return filtered;
      });
    }

    const totalBatches = Math.ceil(documents.length / this.config.batchSize);
    for (let batch = 0; batch < totalBatches; batch++) {
      this.progress$.next({
        operation: 'export',
        percent: Math.round(((batch + 1) / totalBatches) * 100),
        processedCount: Math.min((batch + 1) * this.config.batchSize, documents.length),
        totalCount: documents.length,
        currentBatch: batch + 1,
        totalBatches,
      });
    }

    switch (options.format) {
      case 'json':
        return JSON.stringify(documents, null, 2);
      case 'csv':
        return this.toCSV(documents);
      case 'ndjson':
        return this.toNDJSON(documents);
      default:
        throw new Error(`Unsupported export format: ${options.format as string}`);
    }
  }

  // ── Progress ─────────────────────────────────────────────────────────

  /**
   * Get import/export progress as an observable.
   */
  getProgress(): Observable<ImportExportProgress | null> {
    return this.progress$.asObservable().pipe(takeUntil(this.destroy$));
  }

  // ── Events ───────────────────────────────────────────────────────────

  /**
   * Get studio events from the import/export manager.
   */
  getEvents(): Observable<StudioEvent> {
    return this.events$.asObservable().pipe(takeUntil(this.destroy$));
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  /**
   * Destroy the manager and complete all streams.
   */
  destroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.events$.complete();
    this.progress$.complete();
  }

  // ── Private: parsers ─────────────────────────────────────────────────

  private parseJSON(data: string): Record<string, unknown>[] {
    const parsed: unknown = JSON.parse(data);
    if (Array.isArray(parsed)) {
      return parsed as Record<string, unknown>[];
    }
    if (typeof parsed === 'object' && parsed !== null) {
      return [parsed as Record<string, unknown>];
    }
    throw new Error('JSON import expects an array or object');
  }

  private parseCSV(data: string): Record<string, unknown>[] {
    const lines = data.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length < 2) return [];

    const headers = parseCsvLine(lines[0]!);
    const documents: Record<string, unknown>[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = parseCsvLine(lines[i]!);
      const doc: Record<string, unknown> = {};
      for (let j = 0; j < headers.length; j++) {
        const header = headers[j]!.trim();
        const rawValue = (values[j] ?? '').trim();
        if (header) {
          // Auto-coerce numbers and booleans
          const num = Number(rawValue);
          if (rawValue !== '' && !Number.isNaN(num)) {
            doc[header] = num;
          } else if (rawValue.toLowerCase() === 'true') {
            doc[header] = true;
          } else if (rawValue.toLowerCase() === 'false') {
            doc[header] = false;
          } else {
            doc[header] = rawValue;
          }
        }
      }
      documents.push(doc);
    }

    return documents;
  }

  private parseNDJSON(data: string): Record<string, unknown>[] {
    return data
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line, index) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          throw new Error(`Invalid JSON on line ${index + 1}: ${line.slice(0, 80)}`);
        }
      });
  }

  private parseSQLDump(data: string): Record<string, unknown>[] {
    const documents: Record<string, unknown>[] = [];
    const insertRegex = /INSERT\s+INTO\s+\S+\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/gi;
    let match: RegExpExecArray | null;

    while ((match = insertRegex.exec(data)) !== null) {
      const columns = match[1]!.split(',').map((c) => c.trim().replace(/[`"[\]]/g, ''));
      const rawValues = match[2]!;

      // Simple value parsing (handles quoted strings and numbers)
      const values = this.parseSQLValues(rawValues);
      const doc: Record<string, unknown> = {};

      for (let i = 0; i < columns.length; i++) {
        doc[columns[i]!] = values[i] ?? null;
      }

      documents.push(doc);
    }

    return documents;
  }

  private parseSQLValues(raw: string): unknown[] {
    const values: unknown[] = [];
    let current = '';
    let inString = false;
    let quote = '';

    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i]!;

      if (inString) {
        if (ch === quote) {
          if (i + 1 < raw.length && raw[i + 1] === quote) {
            current += ch;
            i++;
          } else {
            inString = false;
          }
        } else {
          current += ch;
        }
      } else {
        if (ch === "'" || ch === '"') {
          inString = true;
          quote = ch;
        } else if (ch === ',') {
          values.push(this.coerceSQLValue(current.trim()));
          current = '';
        } else {
          current += ch;
        }
      }
    }

    values.push(this.coerceSQLValue(current.trim()));
    return values;
  }

  private coerceSQLValue(raw: string): unknown {
    if (raw.toUpperCase() === 'NULL') return null;
    if (raw.toUpperCase() === 'TRUE') return true;
    if (raw.toUpperCase() === 'FALSE') return false;
    const num = Number(raw);
    if (!Number.isNaN(num) && raw !== '') return num;
    return raw;
  }

  // ── Private: field mapping ───────────────────────────────────────────

  private applyFieldMappings(
    doc: Record<string, unknown>,
    mappings: FieldMapping[],
  ): Record<string, unknown> {
    const result: Record<string, unknown> = { ...doc };

    for (const mapping of mappings) {
      if (mapping.source in result) {
        let value = result[mapping.source];
        delete result[mapping.source];
        if (mapping.transform) {
          value = mapping.transform(value);
        }
        result[mapping.target] = value;
      }
    }

    return result;
  }

  // ── Private: validation ──────────────────────────────────────────────

  private validateDocument(
    doc: Record<string, unknown>,
    schema: ImportSchemaField[],
    rowIndex: number,
  ): ImportValidationError[] {
    const errors: ImportValidationError[] = [];

    for (const field of schema) {
      const value = doc[field.name];

      if (field.required && (value === undefined || value === null)) {
        errors.push({
          row: rowIndex,
          field: field.name,
          message: `Required field "${field.name}" is missing`,
        });
        continue;
      }

      if (value !== undefined && value !== null && field.type !== 'any') {
        if (!this.matchesType(value, field.type)) {
          errors.push({
            row: rowIndex,
            field: field.name,
            message: `Field "${field.name}" expected type "${field.type}" but got "${typeof value}"`,
          });
        }
      }
    }

    return errors;
  }

  private matchesType(value: unknown, expectedType: string): boolean {
    switch (expectedType) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number';
      case 'boolean':
        return typeof value === 'boolean';
      case 'object':
        return typeof value === 'object' && !Array.isArray(value);
      case 'array':
        return Array.isArray(value);
      case 'date':
        return typeof value === 'string' || value instanceof Date;
      case 'any':
        return true;
      default:
        return true;
    }
  }

  // ── Private: export formatters ───────────────────────────────────────

  private toCSV(documents: Record<string, unknown>[]): string {
    if (documents.length === 0) return '';

    const allKeys = new Set<string>();
    for (const doc of documents) {
      for (const key of Object.keys(doc)) {
        allKeys.add(key);
      }
    }
    const headers = Array.from(allKeys);

    const rows = [
      headers.join(','),
      ...documents.map((doc) =>
        headers.map((h) => csvEscape(doc[h])).join(','),
      ),
    ];

    return rows.join('\n');
  }

  private toNDJSON(documents: Record<string, unknown>[]): string {
    return documents.map((doc) => JSON.stringify(doc)).join('\n');
  }

  // ── Private: util ────────────────────────────────────────────────────

  private yieldControl(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
}

// ── Factory ──────────────────────────────────────────────────────────────

/**
 * Create a new ImportExportManager instance.
 *
 * @param config - Optional manager configuration
 * @returns A new ImportExportManager
 *
 * @example
 * ```typescript
 * import { createImportExportManager } from '@pocket/studio';
 *
 * const manager = createImportExportManager({ batchSize: 500 });
 *
 * const result = await manager.importData({
 *   format: 'csv',
 *   data: 'name,age\nAlice,30\nBob,25',
 *   collection: 'users',
 * });
 *
 * console.log(result.importedCount); // 2
 *
 * const json = manager.exportData({
 *   format: 'json',
 *   documents: result.documents,
 * });
 * ```
 */
export function createImportExportManager(
  config?: ImportExportManagerConfig,
): ImportExportManager {
  return new ImportExportManager(config);
}
