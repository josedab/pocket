// --- Types ---

export type ImportFormat = 'csv' | 'json' | 'jsonl' | 'firebase' | 'pouchdb';
export type ExportFormat = 'csv' | 'json' | 'jsonl' | 'sql';

export interface ImportError {
  line?: number;
  message: string;
  data?: unknown;
}

export interface ImportResult {
  collection: string;
  documentsImported: number;
  errors: ImportError[];
  durationMs: number;
}

export interface ExportResult {
  collection: string;
  documentsExported: number;
  format: ExportFormat;
  outputSize: number;
}

export interface ImportOptions {
  format: ImportFormat;
  collection: string;
  idField?: string;
  batchSize?: number;
  skipErrors?: boolean;
  transform?: (doc: Record<string, unknown>) => Record<string, unknown>;
}

export interface ExportOptions {
  format: ExportFormat;
  collection: string;
  filter?: (doc: Record<string, unknown>) => boolean;
  fields?: string[];
  pretty?: boolean;
}

export interface ImportExportConfig {
  maxBatchSize?: number;
  maxDocuments?: number;
}

// --- Parsers ---

function parseCsv(data: string): { docs: Record<string, unknown>[]; errors: ImportError[] } {
  const docs: Record<string, unknown>[] = [];
  const errors: ImportError[] = [];
  const lines = data.split('\n').filter((l) => l.trim() !== '');

  if (lines.length < 2) {
    return { docs, errors };
  }

  const headers = parseCsvLine(lines[0]!);

  for (let i = 1; i < lines.length; i++) {
    try {
      const values = parseCsvLine(lines[i]!);
      const doc: Record<string, unknown> = {};
      for (let j = 0; j < headers.length; j++) {
        doc[headers[j]!] = values[j] ?? '';
      }
      docs.push(doc);
    } catch (err) {
      errors.push({ line: i + 1, message: String(err) });
    }
  }

  return { docs, errors };
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

function parseJson(data: string): { docs: Record<string, unknown>[]; errors: ImportError[] } {
  const errors: ImportError[] = [];
  try {
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) {
      errors.push({ message: 'JSON data must be an array of objects' });
      return { docs: [], errors };
    }
    return { docs: parsed as Record<string, unknown>[], errors };
  } catch (err) {
    errors.push({ message: `Invalid JSON: ${String(err)}` });
    return { docs: [], errors };
  }
}

function parseJsonl(data: string): { docs: Record<string, unknown>[]; errors: ImportError[] } {
  const docs: Record<string, unknown>[] = [];
  const errors: ImportError[] = [];
  const lines = data.split('\n').filter((l) => l.trim() !== '');

  for (let i = 0; i < lines.length; i++) {
    try {
      docs.push(JSON.parse(lines[i]!) as Record<string, unknown>);
    } catch (err) {
      errors.push({ line: i + 1, message: `Invalid JSON on line ${i + 1}: ${String(err)}` });
    }
  }

  return { docs, errors };
}

function parseFirebase(data: string): { docs: Record<string, unknown>[]; errors: ImportError[] } {
  const errors: ImportError[] = [];
  try {
    const parsed = JSON.parse(data) as Record<string, Record<string, Record<string, unknown>>>;
    const docs: Record<string, unknown>[] = [];
    const collections = Object.keys(parsed);
    if (collections.length === 0) {
      return { docs, errors };
    }
    const collection = parsed[collections[0]!];
    for (const [docId, fields] of Object.entries(collection!)) {
      docs.push({ _id: docId, ...(fields as Record<string, unknown>) });
    }
    return { docs, errors };
  } catch (err) {
    errors.push({ message: `Invalid Firebase format: ${String(err)}` });
    return { docs: [], errors };
  }
}

function parsePouchDb(data: string): { docs: Record<string, unknown>[]; errors: ImportError[] } {
  const errors: ImportError[] = [];
  try {
    const parsed = JSON.parse(data) as { rows: { doc: Record<string, unknown> }[] };
    if (!parsed.rows || !Array.isArray(parsed.rows)) {
      errors.push({ message: 'PouchDB data must have a "rows" array' });
      return { docs: [], errors };
    }
    const docs = parsed.rows
      .filter((row) => row.doc)
      .map((row) => row.doc);
    return { docs, errors };
  } catch (err) {
    errors.push({ message: `Invalid PouchDB format: ${String(err)}` });
    return { docs: [], errors };
  }
}

// --- Formatters ---

function formatCsv(docs: Record<string, unknown>[]): string {
  if (docs.length === 0) return '';
  const headers = Object.keys(docs[0]!);
  const headerLine = headers.map((h) => escapeCsvField(h)).join(',');
  const rows = docs.map((doc) =>
    headers.map((h) => escapeCsvField(String(doc[h] ?? ''))).join(','),
  );
  return [headerLine, ...rows].join('\n');
}

function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatJson(docs: Record<string, unknown>[], pretty?: boolean): string {
  return pretty !== false ? JSON.stringify(docs, null, 2) : JSON.stringify(docs);
}

function formatJsonl(docs: Record<string, unknown>[]): string {
  return docs.map((doc) => JSON.stringify(doc)).join('\n');
}

function formatSql(docs: Record<string, unknown>[], collection: string): string {
  if (docs.length === 0) return '';
  const fields = Object.keys(docs[0]!);
  const fieldList = fields.join(', ');
  return docs
    .map((doc) => {
      const values = fields
        .map((f) => {
          const v = doc[f];
          if (v === null || v === undefined) return 'NULL';
          if (typeof v === 'number') return String(v);
          if (typeof v === 'boolean') return v ? '1' : '0';
          return `'${String(v).replace(/'/g, "''")}'`;
        })
        .join(', ');
      return `INSERT INTO ${collection} (${fieldList}) VALUES (${values});`;
    })
    .join('\n');
}

// --- Hub ---

export interface ImportExportHub {
  importData(data: string, options: ImportOptions): Promise<ImportResult>;
  exportData(documents: Record<string, unknown>[], options: ExportOptions): string;
  detectFormat(data: string): ImportFormat | null;
  validateImport(
    data: string,
    format: ImportFormat,
  ): { valid: boolean; documentCount: number; errors: string[] };
  getSupportedFormats(): { import: ImportFormat[]; export: ExportFormat[] };
}

export function createImportExportHub(config?: ImportExportConfig): ImportExportHub {
  const maxDocuments = config?.maxDocuments ?? 100_000;

  function parse(
    data: string,
    format: ImportFormat,
  ): { docs: Record<string, unknown>[]; errors: ImportError[] } {
    switch (format) {
      case 'csv':
        return parseCsv(data);
      case 'json':
        return parseJson(data);
      case 'jsonl':
        return parseJsonl(data);
      case 'firebase':
        return parseFirebase(data);
      case 'pouchdb':
        return parsePouchDb(data);
    }
  }

  async function importData(data: string, options: ImportOptions): Promise<ImportResult> {
    const start = Date.now();
    const { docs, errors } = parse(data, options.format);
    const allErrors = [...errors];

    let imported: Record<string, unknown>[] = [];

    for (let i = 0; i < docs.length; i++) {
      try {
        let doc = docs[i]!;
        if (options.transform) {
          doc = options.transform(doc);
        }
        const idField = options.idField;
        if (idField && doc[idField] !== undefined) {
          doc._id = doc[idField];
        }
        imported.push(doc);
      } catch (err) {
        const importErr: ImportError = { line: i + 1, message: String(err), data: docs[i] };
        allErrors.push(importErr);
        if (!options.skipErrors) {
          break;
        }
      }
    }

    if (maxDocuments && imported.length > maxDocuments) {
      imported = imported.slice(0, maxDocuments);
    }

    return {
      collection: options.collection,
      documentsImported: imported.length,
      errors: allErrors,
      durationMs: Date.now() - start,
    };
  }

  function exportData(documents: Record<string, unknown>[], options: ExportOptions): string {
    let docs = documents;

    if (options.filter) {
      docs = docs.filter(options.filter);
    }

    if (options.fields) {
      const fields = options.fields;
      docs = docs.map((doc) => {
        const filtered: Record<string, unknown> = {};
        for (const f of fields) {
          if (f in doc) {
            filtered[f] = doc[f];
          }
        }
        return filtered;
      });
    }

    switch (options.format) {
      case 'csv':
        return formatCsv(docs);
      case 'json':
        return formatJson(docs, options.pretty);
      case 'jsonl':
        return formatJsonl(docs);
      case 'sql':
        return formatSql(docs, options.collection);
    }
  }

  function detectFormat(data: string): ImportFormat | null {
    const trimmed = data.trim();

    // Try PouchDB format
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.rows && Array.isArray(parsed.rows)) {
          return 'pouchdb';
        }
        // Firebase: object with nested objects
        const keys = Object.keys(parsed);
        const firstKey = keys[0];
        if (
          keys.length > 0 &&
          firstKey !== undefined &&
          typeof parsed[firstKey] === 'object' &&
          !Array.isArray(parsed[firstKey])
        ) {
          const inner = parsed[firstKey] as Record<string, unknown>;
          const innerKeys = Object.keys(inner);
          const firstInnerKey = innerKeys[0];
          if (innerKeys.length > 0 && firstInnerKey !== undefined && typeof inner[firstInnerKey] === 'object') {
            return 'firebase';
          }
        }
      } catch {
        // not valid JSON object
      }
    }

    // Try JSON array
    if (trimmed.startsWith('[')) {
      try {
        JSON.parse(trimmed);
        return 'json';
      } catch {
        // not valid JSON
      }
    }

    // Try JSONL
    const lines = trimmed.split('\n').filter((l) => l.trim() !== '');
    if (lines.length > 0) {
      try {
        JSON.parse(lines[0]!);
        if (lines.length === 1 || lines.every((l) => { try { JSON.parse(l); return true; } catch { return false; } })) {
          return 'jsonl';
        }
      } catch {
        // not JSONL
      }
    }

    // Try CSV (has commas and multiple lines)
    if (lines.length >= 2 && lines[0]!.includes(',')) {
      return 'csv';
    }

    return null;
  }

  function validateImport(
    data: string,
    format: ImportFormat,
  ): { valid: boolean; documentCount: number; errors: string[] } {
    const { docs, errors } = parse(data, format);
    return {
      valid: errors.length === 0 && docs.length > 0,
      documentCount: docs.length,
      errors: errors.map((e) => e.message),
    };
  }

  function getSupportedFormats(): { import: ImportFormat[]; export: ExportFormat[] } {
    return {
      import: ['csv', 'json', 'jsonl', 'firebase', 'pouchdb'],
      export: ['csv', 'json', 'jsonl', 'sql'],
    };
  }

  return {
    importData,
    exportData,
    detectFormat,
    validateImport,
    getSupportedFormats,
  };
}
