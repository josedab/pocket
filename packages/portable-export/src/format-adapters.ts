/**
 * Format adapters for universal data export/import.
 * Each adapter handles serialization and deserialization for a specific format.
 */

export interface FormatAdapter {
  readonly format: string;
  serialize(documents: Record<string, unknown>[], options?: FormatOptions): string;
  deserialize(data: string, options?: FormatOptions): Record<string, unknown>[];
}

export interface FormatOptions {
  pretty?: boolean;
  delimiter?: string;
  tableName?: string;
  includeHeaders?: boolean;
  dateFormat?: 'iso' | 'unix' | 'locale';
  nullValue?: string;
}

/** JSON format adapter */
export class JsonAdapter implements FormatAdapter {
  readonly format = 'json';

  serialize(documents: Record<string, unknown>[], options?: FormatOptions): string {
    return JSON.stringify(documents, null, options?.pretty ? 2 : undefined);
  }

  deserialize(data: string): Record<string, unknown>[] {
    const parsed = JSON.parse(data);
    if (Array.isArray(parsed)) return parsed;
    if (typeof parsed === 'object' && parsed !== null) return [parsed];
    throw new Error('Invalid JSON: expected array or object');
  }
}

/** CSV format adapter */
export class CsvAdapter implements FormatAdapter {
  readonly format = 'csv';

  serialize(documents: Record<string, unknown>[], options?: FormatOptions): string {
    if (documents.length === 0) return '';
    const delimiter = options?.delimiter ?? ',';
    const includeHeaders = options?.includeHeaders !== false;

    const headers = this.collectHeaders(documents);
    const lines: string[] = [];

    if (includeHeaders) {
      lines.push(headers.map((h) => this.escapeField(h, delimiter)).join(delimiter));
    }

    for (const doc of documents) {
      const values = headers.map((h) => {
        const val = doc[h];
        if (val === null || val === undefined) return options?.nullValue ?? '';
        if (val instanceof Date) return val.toISOString();
        if (typeof val === 'object') return JSON.stringify(val);
        return String(val);
      });
      lines.push(values.map((v) => this.escapeField(v, delimiter)).join(delimiter));
    }

    return lines.join('\n');
  }

  deserialize(data: string, options?: FormatOptions): Record<string, unknown>[] {
    const delimiter = options?.delimiter ?? ',';
    const lines = this.splitLines(data);
    if (lines.length < 2) return [];

    const headers = this.parseLine(lines[0]!, delimiter);
    const documents: Record<string, unknown>[] = [];

    for (let i = 1; i < lines.length; i++) {
      if (!lines[i]!.trim()) continue;
      const values = this.parseLine(lines[i]!, delimiter);
      const doc: Record<string, unknown> = {};
      for (let j = 0; j < headers.length; j++) {
        doc[headers[j]!] = this.parseValue(values[j] ?? '');
      }
      documents.push(doc);
    }

    return documents;
  }

  private collectHeaders(documents: Record<string, unknown>[]): string[] {
    const headerSet = new Set<string>();
    for (const doc of documents) {
      for (const key of Object.keys(doc)) headerSet.add(key);
    }
    return Array.from(headerSet);
  }

  private escapeField(value: string, delimiter: string): string {
    if (value.includes(delimiter) || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  private splitLines(data: string): string[] {
    const lines: string[] = [];
    let current = '';
    let inQuotes = false;
    for (const ch of data) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === '\n' && !inQuotes) {
        lines.push(current);
        current = '';
        continue;
      }
      current += ch;
    }
    if (current) lines.push(current);
    return lines;
  }

  private parseLine(line: string, delimiter: string): string[] {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i] ?? '';
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else inQuotes = !inQuotes;
      } else if (ch === delimiter && !inQuotes) {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    fields.push(current);
    return fields;
  }

  private parseValue(value: string): unknown {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    const num = Number(trimmed);
    if (!isNaN(num) && trimmed !== '') return num;
    return trimmed;
  }
}

/** SQL dump format adapter */
export class SqlAdapter implements FormatAdapter {
  readonly format = 'sql';

  serialize(documents: Record<string, unknown>[], options?: FormatOptions): string {
    if (documents.length === 0) return '';
    const table = options?.tableName ?? 'data';
    const headers = this.collectHeaders(documents);

    const lines: string[] = [];
    // CREATE TABLE
    lines.push(`CREATE TABLE IF NOT EXISTS "${table}" (`);
    lines.push(headers.map((h) => `  "${h}" TEXT`).join(',\n'));
    lines.push(');');
    lines.push('');

    // INSERT statements
    for (const doc of documents) {
      const values = headers.map((h) => this.sqlValue(doc[h]));
      lines.push(
        `INSERT INTO "${table}" (${headers.map((h) => `"${h}"`).join(', ')}) VALUES (${values.join(', ')});`
      );
    }

    return lines.join('\n');
  }

  deserialize(data: string): Record<string, unknown>[] {
    // Parse INSERT statements
    const insertRegex = /INSERT\s+INTO\s+["`]?\w+["`]?\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/gi;
    const documents: Record<string, unknown>[] = [];
    let match;

    while ((match = insertRegex.exec(data)) !== null) {
      const cols = match[1]!.split(',').map((c) => c.trim().replace(/["`]/g, ''));
      const vals = this.parseSqlValues(match[2]!);
      const doc: Record<string, unknown> = {};
      for (let i = 0; i < cols.length; i++) {
        doc[cols[i]!] = vals[i] ?? null;
      }
      documents.push(doc);
    }

    return documents;
  }

  private collectHeaders(documents: Record<string, unknown>[]): string[] {
    const headerSet = new Set<string>();
    for (const doc of documents) Object.keys(doc).forEach((k) => headerSet.add(k));
    return Array.from(headerSet);
  }

  private sqlValue(value: unknown): string {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return value ? '1' : '0';
    if (typeof value === 'object') return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
    return `'${String(value).replace(/'/g, "''")}'`;
  }

  private parseSqlValues(valuesStr: string): unknown[] {
    const values: unknown[] = [];
    let current = '';
    let inString = false;
    for (let i = 0; i < valuesStr.length; i++) {
      const ch = valuesStr[i] ?? '';
      if (ch === "'" && !inString) {
        inString = true;
        continue;
      }
      if (ch === "'" && inString) {
        if (valuesStr[i + 1] === "'") {
          current += "'";
          i++;
          continue;
        }
        inString = false;
        continue;
      }
      if (ch === ',' && !inString) {
        values.push(this.parseSqlVal(current.trim()));
        current = '';
        continue;
      }
      current += ch;
    }
    if (current.trim()) values.push(this.parseSqlVal(current.trim()));
    return values;
  }

  private parseSqlVal(val: string): unknown {
    if (val === 'NULL') return null;
    const num = Number(val);
    if (!isNaN(num)) return num;
    return val;
  }
}

/** NDJSON (Newline Delimited JSON) format adapter */
export class NdjsonAdapter implements FormatAdapter {
  readonly format = 'ndjson';

  serialize(documents: Record<string, unknown>[]): string {
    return documents.map((doc) => JSON.stringify(doc)).join('\n');
  }

  deserialize(data: string): Record<string, unknown>[] {
    return data
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
  }
}

/** Get an adapter by format name */
export function getFormatAdapter(format: string): FormatAdapter {
  switch (format.toLowerCase()) {
    case 'json':
      return new JsonAdapter();
    case 'csv':
      return new CsvAdapter();
    case 'sql':
      return new SqlAdapter();
    case 'ndjson':
      return new NdjsonAdapter();
    default:
      throw new Error(`Unsupported format: ${format}`);
  }
}
