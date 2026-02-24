/**
 * UniversalExporter — Portable database export to JSONL, SQLite-compatible SQL, and structured JSON.
 * UniversalImporter — Import from PouchDB, RxDB, Firestore, and MongoDB formats.
 */

import type { CollectionExport, DatabaseSnapshot, ImportError, ImportResult } from './types.js';

// ── Types ──────────────────────────────────────────────────

export type UniversalFormat = 'jsonl' | 'sql-dump' | 'structured-json';
export type ImportSource = 'pouchdb' | 'rxdb' | 'firestore' | 'mongodb' | 'pocket';

export interface UniversalExportConfig {
  format: UniversalFormat;
  collections?: string[];
  includeMetadata?: boolean;
  pretty?: boolean;
}

export interface UniversalImportConfig {
  source: ImportSource;
  mergeStrategy?: 'replace' | 'merge' | 'skip';
  schemaMapping?: Record<string, string>;
  transformDocument?: (doc: Record<string, unknown>, collection: string) => Record<string, unknown>;
}

export interface ExportableDatabase {
  name: string;
  listCollections(): Promise<string[]>;
  collection(name: string): {
    find(filter?: Record<string, unknown>): { exec(): Promise<Record<string, unknown>[]> };
  };
}

// ── Universal Exporter ────────────────────────────────────

export class UniversalExporter {
  /**
   * Export a database to the specified format.
   */
  async export(db: ExportableDatabase, config: UniversalExportConfig): Promise<string> {
    const collectionNames = config.collections ?? (await db.listCollections());
    const snapshot: DatabaseSnapshot = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      collections: [],
      metadata: config.includeMetadata ? { databaseName: db.name } : undefined,
    };

    for (const name of collectionNames) {
      const col = db.collection(name);
      const docs = await col.find().exec();
      snapshot.collections.push({ name, documents: docs });
    }

    switch (config.format) {
      case 'jsonl':
        return this.toJSONL(snapshot);
      case 'sql-dump':
        return this.toSQLDump(snapshot);
      case 'structured-json':
        return config.pretty ? JSON.stringify(snapshot, null, 2) : JSON.stringify(snapshot);
      default:
        throw new Error(`Unsupported format: ${config.format}`);
    }
  }

  private toJSONL(snapshot: DatabaseSnapshot): string {
    const lines: string[] = [];
    lines.push(
      JSON.stringify({
        _type: 'header',
        version: snapshot.version,
        exportedAt: snapshot.exportedAt,
      })
    );

    for (const col of snapshot.collections) {
      lines.push(
        JSON.stringify({ _type: 'collection', name: col.name, count: col.documents.length })
      );
      for (const doc of col.documents) {
        lines.push(JSON.stringify({ _type: 'document', _collection: col.name, ...doc }));
      }
    }

    lines.push(JSON.stringify({ _type: 'footer', totalCollections: snapshot.collections.length }));
    return lines.join('\n');
  }

  private toSQLDump(snapshot: DatabaseSnapshot): string {
    const lines: string[] = [];
    lines.push(`-- Pocket Database Export`);
    lines.push(`-- Exported: ${snapshot.exportedAt}`);
    lines.push('');

    for (const col of snapshot.collections) {
      const safeName = col.name.replace(/[^a-zA-Z0-9_]/g, '_');
      lines.push(`CREATE TABLE IF NOT EXISTS "${safeName}" (_id TEXT PRIMARY KEY, _data JSON);`);

      for (const doc of col.documents) {
        const id = String(doc._id ?? '');
        const data = JSON.stringify(doc).replace(/'/g, "''");
        lines.push(`INSERT INTO "${safeName}" (_id, _data) VALUES ('${id}', '${data}');`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}

// ── Universal Importer ────────────────────────────────────

export class UniversalImporter {
  /**
   * Import data from various database formats.
   */
  async import(
    data: string,
    config: UniversalImportConfig
  ): Promise<{ collections: CollectionExport[]; result: ImportResult }> {
    const parsed = this.parseSource(data, config.source);
    const transform = config.transformDocument;
    const mapping = config.schemaMapping ?? {};

    const collections: CollectionExport[] = [];
    let imported = 0;
    let skipped = 0;
    const errors: ImportError[] = [];
    const collectionNames: string[] = [];

    for (const col of parsed) {
      const targetName = mapping[col.name] ?? col.name;
      const docs: Record<string, unknown>[] = [];

      for (const doc of col.documents) {
        try {
          const transformed = transform ? transform(doc, targetName) : doc;
          docs.push(transformed);
          imported++;
        } catch (e) {
          errors.push({
            collection: targetName,
            documentId: String(doc._id ?? ''),
            message: e instanceof Error ? e.message : String(e),
          });
          skipped++;
        }
      }

      collections.push({ name: targetName, documents: docs });
      collectionNames.push(targetName);
    }

    return {
      collections,
      result: { imported, skipped, errors, collections: collectionNames },
    };
  }

  private parseSource(data: string, source: ImportSource): CollectionExport[] {
    switch (source) {
      case 'pocket':
      case 'rxdb':
        return this.parsePocketFormat(data);
      case 'pouchdb':
        return this.parsePouchDBFormat(data);
      case 'firestore':
        return this.parseFirestoreFormat(data);
      case 'mongodb':
        return this.parseMongoDBFormat(data);
      default:
        throw new Error(`Unsupported import source: ${source}`);
    }
  }

  private parsePocketFormat(data: string): CollectionExport[] {
    const snapshot = JSON.parse(data) as DatabaseSnapshot;
    return snapshot.collections;
  }

  private parsePouchDBFormat(data: string): CollectionExport[] {
    // PouchDB exports as { docs: [...] } or { rows: [{ doc: ... }] }
    const parsed = JSON.parse(data) as {
      docs?: Record<string, unknown>[];
      rows?: { doc: Record<string, unknown> }[];
      db_name?: string;
    };

    const docs = parsed.docs ?? parsed.rows?.map((r) => r.doc) ?? [];
    const dbName = parsed.db_name ?? 'imported';

    return [{ name: dbName, documents: docs.map((d) => this.normalizePouchDoc(d)) }];
  }

  private parseFirestoreFormat(data: string): CollectionExport[] {
    // Firestore exports as { collections: { name: { docs: {...} } } }
    const parsed = JSON.parse(data) as
      | Record<string, Record<string, unknown>[]>
      | { collections: Record<string, unknown[]> };
    const collections: CollectionExport[] = [];

    const source =
      'collections' in parsed
        ? (parsed.collections as Record<string, unknown[]>)
        : (parsed as Record<string, unknown[]>);

    for (const [name, docs] of Object.entries(source)) {
      if (Array.isArray(docs)) {
        collections.push({
          name,
          documents: docs.map((d) => d as Record<string, unknown>),
        });
      }
    }

    return collections;
  }

  private parseMongoDBFormat(data: string): CollectionExport[] {
    // MongoDB exports as NDJSON (one JSON per line) or array
    const lines = data.trim().split('\n');
    const docs: Record<string, unknown>[] = [];

    for (const line of lines) {
      if (!line.trim()) continue;
      const doc = JSON.parse(line) as Record<string, unknown>;
      docs.push(this.normalizeMongoDoc(doc));
    }

    return [{ name: 'imported', documents: docs }];
  }

  private normalizePouchDoc(doc: Record<string, unknown>): Record<string, unknown> {
    const result = { ...doc };
    // PouchDB uses _rev internally
    if (result._rev && typeof result._rev === 'string') {
      result._rev = result._rev.split('-')[0]; // Keep only revision number
    }
    return result;
  }

  private normalizeMongoDoc(doc: Record<string, unknown>): Record<string, unknown> {
    const result = { ...doc };
    // MongoDB uses { $oid: "..." } for _id
    if (result._id && typeof result._id === 'object' && result._id !== null) {
      const oid = result._id as { $oid?: string };
      if (oid.$oid) result._id = oid.$oid;
    }
    return result;
  }
}

export function createUniversalExporter(): UniversalExporter {
  return new UniversalExporter();
}

export function createUniversalImporter(): UniversalImporter {
  return new UniversalImporter();
}
