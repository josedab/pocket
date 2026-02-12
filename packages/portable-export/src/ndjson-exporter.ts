import type { CollectionExport } from './types.js';

export interface NdjsonExporter {
  export(collections: CollectionExport[]): string;
}

export function createNdjsonExporter(): NdjsonExporter {
  function exportNdjson(collections: CollectionExport[]): string {
    const lines: string[] = [];

    for (const collection of collections) {
      for (const doc of collection.documents) {
        const record = {
          _collection: collection.name,
          ...doc,
        };
        lines.push(JSON.stringify(record));
      }
    }

    return lines.join('\n');
  }

  return {
    export: exportNdjson,
  };
}
