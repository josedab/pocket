/**
 * Data inspector for browsing, searching, and exporting collection data.
 *
 * @module @pocket/studio-pro
 *
 * @example
 * ```typescript
 * import { createDataInspector } from '@pocket/studio-pro';
 *
 * const inspector = createDataInspector({ maxHistoryEntries: 50 });
 * const state = inspector.inspect('users', sampleDocs, 0, 10);
 * console.log(state.totalCount);
 * ```
 */

import type {
  DataInspectorState,
  CollectionStats,
  StudioConfig,
} from './types.js';

/**
 * Data inspector API.
 */
export interface DataInspector {
  /** Inspect a collection with pagination. */
  inspect(
    collection: string,
    documents: Record<string, unknown>[],
    page: number,
    pageSize: number,
  ): DataInspectorState;
  /** Search documents by a simple text query across all string fields. */
  search(
    collection: string,
    documents: Record<string, unknown>[],
    query: string,
  ): Record<string, unknown>[];
  /** Get a document by its _id field. */
  getDocumentById(
    collection: string,
    documents: Record<string, unknown>[],
    id: string,
  ): Record<string, unknown> | null;
  /** Get statistics for a collection. */
  getCollectionStats(
    collection: string,
    documents: Record<string, unknown>[],
  ): CollectionStats;
  /** Export collection data as JSON or CSV. */
  exportData(
    collection: string,
    documents: Record<string, unknown>[],
    format: 'json' | 'csv',
  ): string;
}

/**
 * Create a data inspector instance.
 *
 * @example
 * ```typescript
 * const inspector = createDataInspector();
 * const stats = inspector.getCollectionStats('users', documents);
 * console.log(stats.count, stats.avgDocSize);
 * ```
 */
export function createDataInspector(
  _config: Partial<StudioConfig> = {},
): DataInspector {
  function inspect(
    collection: string,
    documents: Record<string, unknown>[],
    page: number,
    pageSize: number,
  ): DataInspectorState {
    const start = page * pageSize;
    const paged = documents.slice(start, start + pageSize);

    return {
      collection,
      documents: paged,
      page,
      pageSize,
      totalCount: documents.length,
      sortField: null,
      sortDirection: 'asc',
    };
  }

  function search(
    _collection: string,
    documents: Record<string, unknown>[],
    query: string,
  ): Record<string, unknown>[] {
    const lower = query.toLowerCase();
    return documents.filter((doc) =>
      Object.values(doc).some(
        (val) => typeof val === 'string' && val.toLowerCase().includes(lower),
      ),
    );
  }

  function getDocumentById(
    _collection: string,
    documents: Record<string, unknown>[],
    id: string,
  ): Record<string, unknown> | null {
    return documents.find((doc) => doc._id === id) ?? null;
  }

  function getCollectionStats(
    _collection: string,
    documents: Record<string, unknown>[],
  ): CollectionStats {
    const fieldSet = new Set<string>();
    let totalSize = 0;

    for (const doc of documents) {
      const serialized = JSON.stringify(doc);
      totalSize += serialized.length;
      for (const key of Object.keys(doc)) {
        fieldSet.add(key);
      }
    }

    return {
      count: documents.length,
      avgDocSize: documents.length > 0 ? Math.round(totalSize / documents.length) : 0,
      fields: [...fieldSet],
    };
  }

  function exportData(
    _collection: string,
    documents: Record<string, unknown>[],
    format: 'json' | 'csv',
  ): string {
    if (format === 'json') {
      return JSON.stringify(documents, null, 2);
    }

    // CSV export
    if (documents.length === 0) return '';

    const allFields = new Set<string>();
    for (const doc of documents) {
      for (const key of Object.keys(doc)) {
        allFields.add(key);
      }
    }
    const headers = [...allFields];
    const rows = documents.map((doc) =>
      headers.map((h) => {
        const val = doc[h];
        if (val === undefined || val === null) return '';
        const str = String(val);
        return str.includes(',') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
      }).join(','),
    );

    return [headers.join(','), ...rows].join('\n');
  }

  return { inspect, search, getDocumentById, getCollectionStats, exportData };
}
