/**
 * Audit Export - Audit trail export for compliance and reporting
 *
 * @module audit-export
 *
 * @example
 * ```typescript
 * import { createAuditExporter } from '@pocket/time-travel';
 * import type { PersistentHistoryEntry } from '@pocket/time-travel';
 *
 * const exporter = createAuditExporter();
 *
 * const entries: PersistentHistoryEntry[] = [
 *   {
 *     id: '1',
 *     timestamp: Date.now(),
 *     operation: 'insert',
 *     collection: 'users',
 *     documentId: 'user-1',
 *     before: null,
 *     after: { name: 'Alice' },
 *   },
 * ];
 *
 * // Export as JSON
 * const report = exporter.export(entries, { format: 'json' });
 * console.log(report.data);
 *
 * // Generate summary statistics
 * const summary = exporter.generateSummary(entries);
 * console.log(summary.operationBreakdown);
 * ```
 */

import type { PersistentHistoryEntry } from './persistent-history.js';

/**
 * Configuration for audit export
 */
export interface AuditExportConfig {
  /** Output format */
  format: 'json' | 'csv' | 'ndjson';
  /** Whether to include metadata in the export */
  includeMetadata?: boolean;
  /** Date format for timestamps */
  dateFormat?: 'iso' | 'unix';
  /** Specific fields to include in the export */
  fields?: string[];
}

/**
 * Generated audit report
 */
export interface AuditReport {
  /** Timestamp when the report was generated */
  generatedAt: number;
  /** Total number of entries in the report */
  totalEntries: number;
  /** Date range covered by the entries */
  dateRange: { start: number; end: number };
  /** Collections present in the entries */
  collections: string[];
  /** Count of entries per operation type */
  operationCounts: Record<string, number>;
  /** Formatted export data */
  data: string;
}

/**
 * Summary statistics for audit entries
 */
export interface AuditSummary {
  /** Total number of entries */
  totalEntries: number;
  /** Number of unique documents */
  uniqueDocuments: number;
  /** Number of unique collections */
  uniqueCollections: number;
  /** Breakdown of operations by type */
  operationBreakdown: Record<string, number>;
  /** Time range of the entries */
  timeRange: { start: number; end: number };
  /** Average entries per hour */
  entriesPerHour: number;
}

/**
 * Escape a value for CSV output
 */
function escapeCsvValue(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Format a timestamp according to the date format setting
 */
function formatTimestamp(timestamp: number, dateFormat: 'iso' | 'unix'): string | number {
  return dateFormat === 'iso' ? new Date(timestamp).toISOString() : timestamp;
}

/**
 * Audit exporter for compliance and reporting
 *
 * Provides export capabilities in multiple formats (JSON, CSV, NDJSON)
 * and generates summary statistics for audit trails.
 *
 * @example
 * ```typescript
 * const exporter = new AuditExporter();
 *
 * const report = exporter.export(entries, {
 *   format: 'csv',
 *   dateFormat: 'iso',
 *   includeMetadata: true,
 * });
 *
 * const summary = exporter.generateSummary(entries);
 * ```
 */
export class AuditExporter {
  /**
   * Export history entries as a formatted audit report
   */
  export(entries: PersistentHistoryEntry[], config: AuditExportConfig): AuditReport {
    const timestamps = entries.map((e) => e.timestamp);
    const collections = [...new Set(entries.map((e) => e.collection))];
    const operationCounts: Record<string, number> = {};

    for (const entry of entries) {
      operationCounts[entry.operation] = (operationCounts[entry.operation] ?? 0) + 1;
    }

    let data: string;
    switch (config.format) {
      case 'csv':
        data = this.formatAsCSV(entries, config);
        break;
      case 'ndjson':
        data = this.formatAsNDJSON(entries, config);
        break;
      case 'json':
      default:
        data = this.formatAsJSON(entries, config);
        break;
    }

    return {
      generatedAt: Date.now(),
      totalEntries: entries.length,
      dateRange: {
        start: entries.length > 0 ? Math.min(...timestamps) : 0,
        end: entries.length > 0 ? Math.max(...timestamps) : 0,
      },
      collections,
      operationCounts,
      data,
    };
  }

  /**
   * Generate summary statistics for a set of history entries
   */
  generateSummary(entries: PersistentHistoryEntry[]): AuditSummary {
    const timestamps = entries.map((e) => e.timestamp);
    const start = entries.length > 0 ? Math.min(...timestamps) : 0;
    const end = entries.length > 0 ? Math.max(...timestamps) : 0;

    const uniqueDocuments = new Set(entries.map((e) => `${e.collection}:${e.documentId}`));
    const uniqueCollections = new Set(entries.map((e) => e.collection));

    const operationBreakdown: Record<string, number> = {};
    for (const entry of entries) {
      operationBreakdown[entry.operation] = (operationBreakdown[entry.operation] ?? 0) + 1;
    }

    const durationHours = entries.length > 0 ? Math.max((end - start) / (1000 * 60 * 60), 1) : 1;

    return {
      totalEntries: entries.length,
      uniqueDocuments: uniqueDocuments.size,
      uniqueCollections: uniqueCollections.size,
      operationBreakdown,
      timeRange: { start, end },
      entriesPerHour: entries.length / durationHours,
    };
  }

  /**
   * Format entries as a JSON string
   */
  formatAsJSON(
    entries: PersistentHistoryEntry[],
    config?: Partial<AuditExportConfig>
  ): string {
    const formatted = entries.map((e) => this.formatEntry(e, config));
    return JSON.stringify(formatted, null, 2);
  }

  /**
   * Format entries as CSV
   */
  formatAsCSV(
    entries: PersistentHistoryEntry[],
    config?: Partial<AuditExportConfig>
  ): string {
    const includeMetadata = config?.includeMetadata ?? false;
    const dateFormat = config?.dateFormat ?? 'iso';

    const headers = ['id', 'timestamp', 'operation', 'collection', 'documentId', 'before', 'after'];
    if (includeMetadata) {
      headers.push('metadata');
    }

    const rows = [headers.join(',')];

    for (const entry of entries) {
      const values = [
        escapeCsvValue(entry.id),
        escapeCsvValue(String(formatTimestamp(entry.timestamp, dateFormat))),
        escapeCsvValue(entry.operation),
        escapeCsvValue(entry.collection),
        escapeCsvValue(entry.documentId),
        escapeCsvValue(entry.before ? JSON.stringify(entry.before) : ''),
        escapeCsvValue(entry.after ? JSON.stringify(entry.after) : ''),
      ];

      if (includeMetadata) {
        values.push(escapeCsvValue(entry.metadata ? JSON.stringify(entry.metadata) : ''));
      }

      rows.push(values.join(','));
    }

    return rows.join('\n');
  }

  /**
   * Format entries as newline-delimited JSON
   */
  formatAsNDJSON(
    entries: PersistentHistoryEntry[],
    config?: Partial<AuditExportConfig>
  ): string {
    return entries.map((e) => JSON.stringify(this.formatEntry(e, config))).join('\n');
  }

  /**
   * Format a single entry according to config
   */
  private formatEntry(
    entry: PersistentHistoryEntry,
    config?: Partial<AuditExportConfig>
  ): Record<string, unknown> {
    const dateFormat = config?.dateFormat ?? 'iso';
    const includeMetadata = config?.includeMetadata ?? false;
    const fields = config?.fields;

    const formatted: Record<string, unknown> = {
      id: entry.id,
      timestamp: formatTimestamp(entry.timestamp, dateFormat),
      operation: entry.operation,
      collection: entry.collection,
      documentId: entry.documentId,
      before: entry.before,
      after: entry.after,
    };

    if (includeMetadata && entry.metadata) {
      formatted.metadata = entry.metadata;
    }

    // Filter to specified fields if provided
    if (fields && fields.length > 0) {
      const filtered: Record<string, unknown> = {};
      for (const field of fields) {
        if (field in formatted) {
          filtered[field] = formatted[field];
        }
      }
      return filtered;
    }

    return formatted;
  }
}

/**
 * Create an audit exporter instance
 *
 * @example
 * ```typescript
 * const exporter = createAuditExporter();
 * const report = exporter.export(entries, { format: 'json' });
 * ```
 */
export function createAuditExporter(): AuditExporter {
  return new AuditExporter();
}
