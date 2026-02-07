import type { CollectionExport, DatabaseSnapshot, ExportConfig } from './types.js';

export interface JsonExporter {
  export(collections: CollectionExport[], config?: Partial<ExportConfig>): string;
  exportCollection(name: string, docs: Record<string, unknown>[], config?: Partial<ExportConfig>): string;
}

export function createJsonExporter(): JsonExporter {
  function exportCollections(collections: CollectionExport[], config?: Partial<ExportConfig>): string {
    const includeMetadata = config?.includeMetadata ?? true;
    const prettyPrint = config?.prettyPrint ?? false;

    const snapshot: DatabaseSnapshot = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      collections,
      ...(includeMetadata
        ? { metadata: { format: 'pocket-export', collectionCount: collections.length } }
        : {}),
    };

    return prettyPrint
      ? JSON.stringify(snapshot, null, 2)
      : JSON.stringify(snapshot);
  }

  function exportCollection(
    name: string,
    docs: Record<string, unknown>[],
    config?: Partial<ExportConfig>,
  ): string {
    const prettyPrint = config?.prettyPrint ?? false;
    const collection: CollectionExport = { name, documents: docs };
    return prettyPrint
      ? JSON.stringify(collection, null, 2)
      : JSON.stringify(collection);
  }

  return {
    export: exportCollections,
    exportCollection,
  };
}
