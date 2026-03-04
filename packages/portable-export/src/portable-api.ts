/**
 * Unified portable export/import API.
 * Provides both programmatic and CLI-friendly interfaces.
 */
import type { Observable } from 'rxjs';
import { getFormatAdapter, type FormatOptions } from './format-adapters.js';
import {
  StreamingPipeline,
  type PipelineProgress,
  type StreamingPipelineConfig,
} from './streaming-pipeline.js';

export interface PortableExportOptions {
  format: 'json' | 'csv' | 'sql' | 'ndjson';
  collections: Record<string, Record<string, unknown>[]>;
  formatOptions?: FormatOptions;
  streaming?: StreamingPipelineConfig;
  includeMetadata?: boolean;
}

export interface PortableImportOptions {
  format: 'json' | 'csv' | 'sql' | 'ndjson';
  data: string;
  formatOptions?: FormatOptions;
  validateSchema?: boolean;
  mergeStrategy?: 'replace' | 'merge' | 'skip';
}

export interface ExportOutput {
  format: string;
  data: string;
  collections: string[];
  documentCount: number;
  byteSize: number;
  exportedAt: string;
  checksum: string;
}

export interface ImportOutput {
  collections: string[];
  documentCount: number;
  documents: Record<string, Record<string, unknown>[]>;
  importedAt: string;
  errors: { collection: string; error: string }[];
}

/**
 * Unified export/import API
 */
export class PortableAPI {
  /** Export collections to a format */
  export(options: PortableExportOptions): ExportOutput {
    const adapter = getFormatAdapter(options.format);
    const allDocs: Record<string, unknown>[] = [];
    const parts: string[] = [];

    for (const [collection, docs] of Object.entries(options.collections)) {
      const enriched = options.includeMetadata
        ? docs.map((d) => ({
            ...d,
            _collection: collection,
            _exportedAt: new Date().toISOString(),
          }))
        : docs;

      if (options.format === 'sql') {
        parts.push(
          adapter.serialize(enriched, { ...options.formatOptions, tableName: collection })
        );
      } else {
        allDocs.push(...enriched);
      }
    }

    const data =
      parts.length > 0 ? parts.join('\n\n') : adapter.serialize(allDocs, options.formatOptions);
    const documentCount = Object.values(options.collections).reduce(
      (sum, docs) => sum + docs.length,
      0
    );

    return {
      format: options.format,
      data,
      collections: Object.keys(options.collections),
      documentCount,
      byteSize: new TextEncoder().encode(data).length,
      exportedAt: new Date().toISOString(),
      checksum: this.computeChecksum(data),
    };
  }

  /** Import data from a format */
  import(options: PortableImportOptions): ImportOutput {
    const adapter = getFormatAdapter(options.format);
    const errors: { collection: string; error: string }[] = [];

    let documents: Record<string, unknown>[];
    try {
      documents = adapter.deserialize(options.data, options.formatOptions);
    } catch (err) {
      return {
        collections: [],
        documentCount: 0,
        documents: {},
        importedAt: new Date().toISOString(),
        errors: [{ collection: '_parse', error: err instanceof Error ? err.message : String(err) }],
      };
    }

    // Group by _collection metadata if present
    const grouped: Record<string, Record<string, unknown>[]> = {};
    for (const doc of documents) {
      const collection = typeof doc._collection === 'string' ? doc._collection : 'default';
      grouped[collection] ??= [];
      const clean = { ...doc };
      delete clean._collection;
      delete clean._exportedAt;
      grouped[collection].push(clean);
    }

    return {
      collections: Object.keys(grouped),
      documentCount: documents.length,
      documents: grouped,
      importedAt: new Date().toISOString(),
      errors,
    };
  }

  /** Create a streaming export pipeline */
  createExportStream(
    format: string,
    documents: Record<string, unknown>[],
    config?: StreamingPipelineConfig
  ): { stream: AsyncGenerator<string>; progress$: Observable<PipelineProgress> } {
    const adapter = getFormatAdapter(format);
    const pipeline = new StreamingPipeline(config);

    return {
      stream: pipeline.exportStream(documents, (chunk) => {
        if (format === 'ndjson') {
          return chunk.map((d) => JSON.stringify(d)).join('\n') + '\n';
        }
        return adapter.serialize(chunk) + '\n';
      }),
      progress$: pipeline.progress,
    };
  }

  /** Verify export integrity via checksum */
  verifyChecksum(data: string, expectedChecksum: string): boolean {
    return this.computeChecksum(data) === expectedChecksum;
  }

  private computeChecksum(data: string): string {
    // Simple FNV-1a hash for checksum
    let hash = 2166136261;
    for (let i = 0; i < data.length; i++) {
      hash ^= data.charCodeAt(i);
      hash = (hash * 16777619) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  }
}

export function createPortableAPI(): PortableAPI {
  return new PortableAPI();
}
