import type { ImportError, ImportResult, ExportFormat, DatabaseSnapshot } from './types.js';

export interface Importer {
  importJson(data: string): ImportResult;
  importCsv(data: string, collection: string): ImportResult;
  importNdjson(data: string): ImportResult;
  validate(data: string, format: ExportFormat): { valid: boolean; errors: string[] };
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"' && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i += 2;
      } else if (char === '"') {
        inQuotes = false;
        i++;
      } else {
        current += char;
        i++;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
      } else if (char === delimiter) {
        values.push(current);
        current = '';
        i++;
      } else {
        current += char;
        i++;
      }
    }
  }

  values.push(current);
  return values;
}

export function createImporter(): Importer {
  function importJson(data: string): ImportResult {
    const errors: ImportError[] = [];
    let imported = 0;
    let skipped = 0;
    const collections: string[] = [];

    try {
      const parsed = JSON.parse(data) as DatabaseSnapshot;

      if (!parsed.collections || !Array.isArray(parsed.collections)) {
        return {
          imported: 0,
          skipped: 0,
          errors: [{ collection: '', message: 'Invalid snapshot: missing collections array' }],
          collections: [],
        };
      }

      for (const col of parsed.collections) {
        if (!col.name || !Array.isArray(col.documents)) {
          errors.push({ collection: col.name ?? 'unknown', message: 'Invalid collection structure' });
          skipped++;
          continue;
        }

        collections.push(col.name);
        imported += col.documents.length;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown parse error';
      errors.push({ collection: '', message: `JSON parse error: ${message}` });
    }

    return { imported, skipped, errors, collections };
  }

  function importCsv(data: string, collection: string): ImportResult {
    const errors: ImportError[] = [];
    let imported = 0;
    const lines = data.split('\n').filter((l) => l.trim().length > 0);

    if (lines.length < 2) {
      return {
        imported: 0,
        skipped: 0,
        errors: lines.length === 0
          ? [{ collection, message: 'Empty CSV data' }]
          : [],
        collections: lines.length > 0 ? [collection] : [],
      };
    }

    const headers = parseCsvLine(lines[0]!, ',');

    for (let i = 1; i < lines.length; i++) {
      try {
        const values = parseCsvLine(lines[i]!, ',');
        if (values.length !== headers.length) {
          errors.push({
            collection,
            message: `Column count mismatch at line ${i + 1}: expected ${headers.length}, got ${values.length}`,
            line: i + 1,
          });
          continue;
        }
        imported++;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        errors.push({ collection, message, line: i + 1 });
      }
    }

    return { imported, skipped: 0, errors, collections: [collection] };
  }

  function importNdjson(data: string): ImportResult {
    const errors: ImportError[] = [];
    let imported = 0;
    const collectionsSet = new Set<string>();

    const lines = data.split('\n').filter((l) => l.trim().length > 0);

    for (let i = 0; i < lines.length; i++) {
      try {
        const parsed = JSON.parse(lines[i]!) as Record<string, unknown>;
        const collection = typeof parsed._collection === 'string' ? parsed._collection : 'default';
        collectionsSet.add(collection);
        imported++;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown parse error';
        errors.push({ collection: 'unknown', message: `Line ${i + 1}: ${message}`, line: i + 1 });
      }
    }

    return { imported, skipped: 0, errors, collections: Array.from(collectionsSet) };
  }

  function validate(data: string, format: ExportFormat): { valid: boolean; errors: string[] } {
    const validationErrors: string[] = [];

    switch (format) {
      case 'json': {
        try {
          const parsed = JSON.parse(data) as Record<string, unknown>;
          if (!parsed.collections) {
            validationErrors.push('Missing "collections" field');
          }
          if (!parsed.version) {
            validationErrors.push('Missing "version" field');
          }
        } catch {
          validationErrors.push('Invalid JSON');
        }
        break;
      }
      case 'csv': {
        const lines = data.split('\n').filter((l) => l.trim().length > 0);
        if (lines.length === 0) {
          validationErrors.push('Empty CSV data');
        }
        break;
      }
      case 'ndjson': {
        const lines = data.split('\n').filter((l) => l.trim().length > 0);
        for (let i = 0; i < lines.length; i++) {
          try {
            JSON.parse(lines[i]!);
          } catch {
            validationErrors.push(`Invalid JSON at line ${i + 1}`);
          }
        }
        break;
      }
      case 'sql': {
        if (!data.trim().length) {
          validationErrors.push('Empty SQL data');
        }
        break;
      }
    }

    return { valid: validationErrors.length === 0, errors: validationErrors };
  }

  return {
    importJson,
    importCsv,
    importNdjson,
    validate,
  };
}
