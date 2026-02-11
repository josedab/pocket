/**
 * @module @pocket/portable-export/format-detector
 *
 * Auto-detect export format from raw data string.
 * Supports Pocket formats (JSON, CSV, NDJSON, SQL) and competitor
 * formats (RxDB, PouchDB, Firestore).
 */
import type { CompetitorFormat } from './competitor-import.js';
import type { ExportFormat } from './types.js';

export type DetectedFormat =
  | { type: 'pocket'; format: ExportFormat }
  | { type: 'competitor'; format: CompetitorFormat }
  | { type: 'unknown' };

export interface FormatDetector {
  detect(data: string): DetectedFormat;
}

export function createFormatDetector(): FormatDetector {
  function detect(data: string): DetectedFormat {
    const trimmed = data.trim();

    if (trimmed.length === 0) {
      return { type: 'unknown' };
    }

    // SQL detection
    if (/^(CREATE\s+TABLE|INSERT\s+INTO|DROP\s+TABLE|BEGIN|--)/i.test(trimmed)) {
      return { type: 'pocket', format: 'sql' };
    }

    // Try JSON parsing
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;

        // Pocket JSON export: has version + collections array
        if (parsed.version && Array.isArray(parsed.collections)) {
          return { type: 'pocket', format: 'json' };
        }

        // RxDB: has instanceToken or collections with schemaHash/docs
        if (parsed.instanceToken) {
          return { type: 'competitor', format: 'rxdb' };
        }
        if (
          parsed.collections &&
          typeof parsed.collections === 'object' &&
          !Array.isArray(parsed.collections)
        ) {
          const cols = parsed.collections as Record<string, unknown>;
          const firstCol = Object.values(cols)[0] as Record<string, unknown> | undefined;
          if (firstCol?.schemaHash || firstCol?.docs) {
            return { type: 'competitor', format: 'rxdb' };
          }
        }

        // PouchDB: has rows array + total_rows or db_name
        if ((parsed.total_rows !== undefined || parsed.db_name) && Array.isArray(parsed.rows)) {
          return { type: 'competitor', format: 'pouchdb' };
        }

        // Firestore: documents with fields containing typed values
        if (Array.isArray(parsed.documents)) {
          const firstDoc = parsed.documents[0] as Record<string, unknown> | undefined;
          if (firstDoc?.fields || firstDoc?.name) {
            return { type: 'competitor', format: 'firestore' };
          }
        }

        return { type: 'pocket', format: 'json' };
      } catch {
        // Not valid JSON as a whole — check NDJSON
      }
    }

    // NDJSON detection: multiple lines, each valid JSON
    const lines = trimmed.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length > 0) {
      let jsonLineCount = 0;
      const sampleSize = Math.min(lines.length, 5);
      for (let i = 0; i < sampleSize; i++) {
        try {
          JSON.parse(lines[i]!);
          jsonLineCount++;
        } catch {
          // not JSON
        }
      }
      if (jsonLineCount === sampleSize && lines.length > 1) {
        return { type: 'pocket', format: 'ndjson' };
      }
    }

    // CSV detection: has comma/tab-separated header with at least 2 columns
    if (lines.length >= 2) {
      const firstLine = lines[0]!;
      const commaCount = (firstLine.match(/,/g) ?? []).length;
      const tabCount = (firstLine.match(/\t/g) ?? []).length;
      if (commaCount >= 1 || tabCount >= 1) {
        return { type: 'pocket', format: 'csv' };
      }
    }

    return { type: 'unknown' };
  }

  return { detect };
}
