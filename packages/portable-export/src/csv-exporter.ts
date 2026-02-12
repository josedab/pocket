import type { CollectionExport, ExportConfig } from './types.js';

export interface CsvExporter {
  export(collection: CollectionExport, config?: Partial<ExportConfig>): string;
}

function flattenObject(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const key of Object.keys(obj)) {
    const value = obj[key];
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      const nested = flattenObject(value as Record<string, unknown>, fullKey);
      for (const nestedKey of Object.keys(nested)) {
        result[nestedKey] = nested[nestedKey];
      }
    } else {
      result[fullKey] = value;
    }
  }

  return result;
}

function escapeCsvValue(value: unknown, delimiter: string): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    const serialized = JSON.stringify(value);
    return `"${serialized.replace(/"/g, '""')}"`;
  }

  const str = String(value);
  if (str.includes(delimiter) || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

export function createCsvExporter(): CsvExporter {
  function exportCsv(collection: CollectionExport, config?: Partial<ExportConfig>): string {
    const delimiter = config?.delimiter ?? ',';
    const { documents } = collection;

    if (documents.length === 0) {
      return '';
    }

    // Flatten all documents to get all possible headers
    const flatDocs = documents.map((doc) => flattenObject(doc));
    const headerSet = new Set<string>();
    for (const doc of flatDocs) {
      for (const key of Object.keys(doc)) {
        headerSet.add(key);
      }
    }
    const headers = Array.from(headerSet);

    // Build CSV
    const lines: string[] = [];
    lines.push(headers.map((h) => escapeCsvValue(h, delimiter)).join(delimiter));

    for (const doc of flatDocs) {
      const row = headers.map((h) => escapeCsvValue(doc[h], delimiter));
      lines.push(row.join(delimiter));
    }

    return lines.join('\n');
  }

  return {
    export: exportCsv,
  };
}
