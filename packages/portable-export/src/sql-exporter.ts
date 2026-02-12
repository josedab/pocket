import type { CollectionExport } from './types.js';

export interface SqlExporter {
  export(collections: CollectionExport[]): string;
}

function inferSqlType(value: unknown): string {
  if (value === null || value === undefined) {
    return 'TEXT';
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'INTEGER' : 'REAL';
  }
  if (typeof value === 'boolean') {
    return 'INTEGER';
  }
  return 'TEXT';
}

function escapeSqlIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function escapeSqlValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }
  if (typeof value === 'object') {
    const serialized = JSON.stringify(value);
    return `'${serialized.replace(/'/g, "''")}'`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sanitizeTableName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_');
}

export function createSqlExporter(): SqlExporter {
  function exportSql(collections: CollectionExport[]): string {
    const statements: string[] = [];

    for (const collection of collections) {
      const tableName = sanitizeTableName(collection.name);
      const { documents } = collection;

      if (documents.length === 0) {
        statements.push(`CREATE TABLE IF NOT EXISTS ${escapeSqlIdentifier(tableName)} (id TEXT PRIMARY KEY);`);
        continue;
      }

      // Gather all columns and infer types from first non-null value
      const columnTypes = new Map<string, string>();
      for (const doc of documents) {
        for (const [key, value] of Object.entries(doc)) {
          if (!columnTypes.has(key) || columnTypes.get(key) === 'TEXT') {
            if (value !== null && value !== undefined) {
              columnTypes.set(key, inferSqlType(value));
            } else if (!columnTypes.has(key)) {
              columnTypes.set(key, 'TEXT');
            }
          }
        }
      }

      const columns = Array.from(columnTypes.entries());

      // CREATE TABLE
      const columnDefs = columns
        .map(([name, type]) => `  ${escapeSqlIdentifier(name)} ${type}`)
        .join(',\n');
      statements.push(`CREATE TABLE IF NOT EXISTS ${escapeSqlIdentifier(tableName)} (\n${columnDefs}\n);`);

      // INSERT statements
      const columnNames = columns.map(([name]) => escapeSqlIdentifier(name)).join(', ');
      for (const doc of documents) {
        const values = columns.map(([name]) => escapeSqlValue(doc[name])).join(', ');
        statements.push(`INSERT INTO ${escapeSqlIdentifier(tableName)} (${columnNames}) VALUES (${values});`);
      }
    }

    return statements.join('\n\n');
  }

  return {
    export: exportSql,
  };
}
