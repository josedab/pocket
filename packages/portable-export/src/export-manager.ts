import { BehaviorSubject } from 'rxjs';
import type { Observable } from 'rxjs';
import type {
  CollectionExport,
  ExportConfig,
  ExportProgress,
  ExportResult,
  ImportConfig,
  ImportResult,
} from './types.js';
import { createJsonExporter } from './json-exporter.js';
import { createCsvExporter } from './csv-exporter.js';
import { createSqlExporter } from './sql-exporter.js';
import { createNdjsonExporter } from './ndjson-exporter.js';
import { createImporter } from './importer.js';
import { createIntegrityChecker } from './integrity.js';

export interface ExportManager {
  export(collections: CollectionExport[], config?: Partial<ExportConfig>): ExportResult;
  import(data: string, config?: Partial<ImportConfig>): ImportResult;
  progress$: Observable<ExportProgress>;
}

export function createExportManager(config?: Partial<ExportConfig>): ExportManager {
  const progressSubject = new BehaviorSubject<ExportProgress>({
    phase: 'preparing',
    current: 0,
    total: 0,
  });

  const jsonExporter = createJsonExporter();
  const csvExporter = createCsvExporter();
  const sqlExporter = createSqlExporter();
  const ndjsonExporter = createNdjsonExporter();
  const importer = createImporter();
  const integrity = createIntegrityChecker();

  function exportData(
    collections: CollectionExport[],
    exportConfig?: Partial<ExportConfig>,
  ): ExportResult {
    const mergedConfig = { ...config, ...exportConfig };
    const format = mergedConfig.format ?? 'json';

    // Filter collections if specified
    const filteredCollections = mergedConfig.collections
      ? collections.filter((c) => mergedConfig.collections!.includes(c.name))
      : collections;

    const total = filteredCollections.reduce((sum, c) => sum + c.documents.length, 0);

    progressSubject.next({ phase: 'preparing', current: 0, total });

    let data: string;
    let current = 0;

    switch (format) {
      case 'json': {
        progressSubject.next({ phase: 'exporting', current: 0, total });
        data = jsonExporter.export(filteredCollections, mergedConfig);
        current = total;
        break;
      }
      case 'csv': {
        // CSV exports first collection only
        const collection = filteredCollections[0];
        if (!collection) {
          data = '';
          break;
        }
        progressSubject.next({
          phase: 'exporting',
          current: 0,
          total: collection.documents.length,
          collection: collection.name,
        });
        data = csvExporter.export(collection, mergedConfig);
        current = collection.documents.length;
        break;
      }
      case 'sql': {
        progressSubject.next({ phase: 'exporting', current: 0, total });
        data = sqlExporter.export(filteredCollections);
        current = total;
        break;
      }
      case 'ndjson': {
        progressSubject.next({ phase: 'exporting', current: 0, total });
        data = ndjsonExporter.export(filteredCollections);
        current = total;
        break;
      }
      default:
        throw new Error(`Unsupported export format: ${format as string}`);
    }

    const checksum = integrity.generateChecksum(data);

    progressSubject.next({ phase: 'finalizing', current, total });

    const result: ExportResult = {
      data,
      format,
      collectionCount: filteredCollections.length,
      documentCount: total,
      exportedAt: new Date().toISOString(),
      sizeBytes: new TextEncoder().encode(data).byteLength,
      checksum,
    };

    progressSubject.next({ phase: 'finalizing', current: total, total });

    return result;
  }

  function importData(data: string, importConfig?: Partial<ImportConfig>): ImportResult {
    const format = importConfig?.format ?? config?.format ?? 'json';

    switch (format) {
      case 'json':
        return importer.importJson(data);
      case 'csv':
        return importer.importCsv(data, 'imported');
      case 'ndjson':
        return importer.importNdjson(data);
      default:
        return {
          imported: 0,
          skipped: 0,
          errors: [{ collection: '', message: `Unsupported import format: ${format}` }],
          collections: [],
        };
    }
  }

  return {
    export: exportData,
    import: importData,
    progress$: progressSubject.asObservable(),
  };
}
