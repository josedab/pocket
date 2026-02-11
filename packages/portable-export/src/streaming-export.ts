/**
 * @module @pocket/portable-export/streaming-export
 *
 * Streaming export for large datasets. Uses async generators to process
 * collections in chunks, avoiding memory pressure with large databases.
 *
 * @example
 * ```typescript
 * const streamer = createStreamingExporter();
 * const chunks: string[] = [];
 * for await (const chunk of streamer.exportJsonStream(collections, { chunkSize: 100 })) {
 *   chunks.push(chunk);
 * }
 * ```
 */
import type { CollectionExport, ExportFormat } from './types.js';

export interface StreamingExportConfig {
  chunkSize?: number;
  format?: ExportFormat;
  includeMetadata?: boolean;
}

export interface StreamingExportProgress {
  phase: 'header' | 'data' | 'footer';
  collection: string;
  processedDocs: number;
  totalDocs: number;
  bytesWritten: number;
}

export interface StreamingExporter {
  exportJsonStream(
    collections: CollectionExport[],
    config?: StreamingExportConfig
  ): AsyncGenerator<string, void, undefined>;
  exportNdjsonStream(
    collections: CollectionExport[],
    config?: StreamingExportConfig
  ): AsyncGenerator<string, void, undefined>;
  exportCsvStream(
    collection: CollectionExport,
    config?: StreamingExportConfig
  ): AsyncGenerator<string, void, undefined>;
}

export function createStreamingExporter(): StreamingExporter {
  async function* exportJsonStream(
    collections: CollectionExport[],
    config?: StreamingExportConfig
  ): AsyncGenerator<string, void, undefined> {
    const chunkSize = config?.chunkSize ?? 100;
    const includeMetadata = config?.includeMetadata ?? true;

    // Header
    const header: Record<string, unknown> = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      ...(includeMetadata
        ? { metadata: { format: 'pocket-export-stream', collectionCount: collections.length } }
        : {}),
    };
    yield `{"version":${JSON.stringify(header.version)},"exportedAt":${JSON.stringify(header.exportedAt)}${includeMetadata ? `,"metadata":${JSON.stringify(header.metadata)}` : ''},"collections":[`;

    for (let ci = 0; ci < collections.length; ci++) {
      const col = collections[ci]!;
      if (ci > 0) yield ',';

      yield `{"name":${JSON.stringify(col.name)},"documents":[`;

      for (let i = 0; i < col.documents.length; i += chunkSize) {
        const chunk = col.documents.slice(i, i + chunkSize);
        const serialized = chunk.map((doc) => JSON.stringify(doc));

        if (i > 0) yield ',';
        yield serialized.join(',');
      }

      yield ']}';
    }

    yield ']}';
  }

  async function* exportNdjsonStream(
    collections: CollectionExport[],
    config?: StreamingExportConfig
  ): AsyncGenerator<string, void, undefined> {
    const chunkSize = config?.chunkSize ?? 100;

    for (const col of collections) {
      for (let i = 0; i < col.documents.length; i += chunkSize) {
        const chunk = col.documents.slice(i, i + chunkSize);
        const lines = chunk
          .map((doc) => JSON.stringify({ _collection: col.name, ...doc }))
          .join('\n');
        yield lines + '\n';
      }
    }
  }

  async function* exportCsvStream(
    collection: CollectionExport,
    config?: StreamingExportConfig
  ): AsyncGenerator<string, void, undefined> {
    const chunkSize = config?.chunkSize ?? 100;
    const { documents } = collection;

    if (documents.length === 0) return;

    // Collect all headers from entire collection
    const headerSet = new Set<string>();
    for (const doc of documents) {
      for (const key of Object.keys(doc)) {
        headerSet.add(key);
      }
    }
    const headers = Array.from(headerSet);

    // Yield header row
    yield headers.map(escapeCsvValue).join(',') + '\n';

    // Yield data in chunks
    for (let i = 0; i < documents.length; i += chunkSize) {
      const chunk = documents.slice(i, i + chunkSize);
      const rows = chunk.map((doc) => headers.map((h) => escapeCsvValue(doc[h])).join(','));
      yield rows.join('\n') + '\n';
    }
  }

  return { exportJsonStream, exportNdjsonStream, exportCsvStream };
}

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
