/**
 * @module @pocket/portable-export/competitor-import
 *
 * Import data from competing database formats including RxDB, PouchDB,
 * and Firebase Firestore export formats.
 *
 * @example
 * ```typescript
 * const importer = createCompetitorImporter();
 * const result = importer.importFromRxDB(rxdbData);
 * const result2 = importer.importFromPouchDB(pouchData);
 * const result3 = importer.importFromFirestore(firestoreData);
 * ```
 */
import type { CollectionExport, ImportError, ImportResult } from './types.js';

export type CompetitorFormat = 'rxdb' | 'pouchdb' | 'firestore';

export interface CompetitorImporter {
  detectFormat(data: string): CompetitorFormat | null;
  importFromRxDB(data: string): CompetitorImportResult;
  importFromPouchDB(data: string): CompetitorImportResult;
  importFromFirestore(data: string): CompetitorImportResult;
  importAuto(data: string): CompetitorImportResult;
}

export interface CompetitorImportResult extends ImportResult {
  sourceFormat: CompetitorFormat | 'unknown';
  collections: string[];
  convertedCollections: CollectionExport[];
}

interface RxDBExport {
  name?: string;
  instanceToken?: string;
  collections?: Record<string, RxDBCollectionExport>;
}

interface RxDBCollectionExport {
  name?: string;
  schemaHash?: string;
  docs?: Record<string, unknown>[];
}

interface PouchDBRow {
  id?: string;
  key?: string;
  value?: { rev?: string };
  doc?: Record<string, unknown>;
}

interface PouchDBExport {
  db_name?: string;
  total_rows?: number;
  rows?: PouchDBRow[];
}

interface FirestoreDoc {
  name?: string;
  fields?: Record<string, FirestoreValue>;
  createTime?: string;
  updateTime?: string;
}

interface FirestoreValue {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  timestampValue?: string;
  nullValue?: null;
  arrayValue?: { values?: FirestoreValue[] };
  mapValue?: { fields?: Record<string, FirestoreValue> };
}

interface FirestoreExport {
  documents?: FirestoreDoc[];
  collections?: Record<string, { documents?: FirestoreDoc[] }>;
}

function convertFirestoreValue(value: FirestoreValue): unknown {
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.integerValue !== undefined) return parseInt(value.integerValue, 10);
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.timestampValue !== undefined) return value.timestampValue;
  if (value.nullValue !== undefined) return null;
  if (value.arrayValue?.values) {
    return value.arrayValue.values.map(convertFirestoreValue);
  }
  if (value.mapValue?.fields) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value.mapValue.fields)) {
      result[k] = convertFirestoreValue(v);
    }
    return result;
  }
  return null;
}

export function createCompetitorImporter(): CompetitorImporter {
  function detectFormat(data: string): CompetitorFormat | null {
    try {
      const parsed = JSON.parse(data) as Record<string, unknown>;

      // RxDB: has instanceToken or collections with schemaHash
      if (parsed.instanceToken || (parsed.collections && typeof parsed.collections === 'object')) {
        const cols = parsed.collections as Record<string, unknown> | undefined;
        if (cols) {
          const firstCol = Object.values(cols)[0] as Record<string, unknown> | undefined;
          if (firstCol?.schemaHash || firstCol?.docs) {
            return 'rxdb';
          }
        }
        if (parsed.instanceToken) return 'rxdb';
      }

      // PouchDB: has rows array with doc objects, total_rows
      if (parsed.total_rows !== undefined && Array.isArray(parsed.rows)) {
        return 'pouchdb';
      }
      if (parsed.db_name && Array.isArray(parsed.rows)) {
        return 'pouchdb';
      }

      // Firestore: has documents array with fields containing typed values
      if (Array.isArray(parsed.documents)) {
        const firstDoc = parsed.documents[0] as Record<string, unknown> | undefined;
        if (firstDoc?.fields || firstDoc?.name) {
          return 'firestore';
        }
      }
      if (parsed.collections && typeof parsed.collections === 'object') {
        const cols = parsed.collections as Record<string, unknown>;
        const firstCol = Object.values(cols)[0] as Record<string, unknown> | undefined;
        if (firstCol?.documents) return 'firestore';
      }

      return null;
    } catch {
      return null;
    }
  }

  function importFromRxDB(data: string): CompetitorImportResult {
    const errors: ImportError[] = [];
    const convertedCollections: CollectionExport[] = [];
    let imported = 0;

    try {
      const parsed = JSON.parse(data) as RxDBExport;
      const collections = parsed.collections ?? {};

      for (const [name, col] of Object.entries(collections)) {
        const colName = col.name ?? name;
        const docs = (col.docs ?? []).map((doc) => {
          const cleaned: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(doc)) {
            // Strip RxDB internal fields
            if (!key.startsWith('_') || key === '_id') {
              cleaned[key === '_id' ? 'id' : key] = value;
            }
          }
          return cleaned;
        });

        convertedCollections.push({ name: colName, documents: docs });
        imported += docs.length;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      errors.push({ collection: '', message: `RxDB import error: ${message}` });
    }

    return {
      imported,
      skipped: 0,
      errors,
      sourceFormat: 'rxdb',
      collections: convertedCollections.map((c) => c.name),
      convertedCollections,
    };
  }

  function importFromPouchDB(data: string): CompetitorImportResult {
    const errors: ImportError[] = [];
    const documents: Record<string, unknown>[] = [];
    let imported = 0;
    let skipped = 0;

    try {
      const parsed = JSON.parse(data) as PouchDBExport;
      const collectionName = parsed.db_name ?? 'imported';
      const rows = parsed.rows ?? [];

      for (const row of rows) {
        const doc = row.doc ?? {};

        // Skip PouchDB design documents
        const docId = doc._id ?? row.id ?? row.key;
        if (typeof docId === 'string' && docId.startsWith('_design/')) {
          skipped++;
          continue;
        }

        const cleaned: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(doc)) {
          // Strip PouchDB internal fields
          if (key !== '_rev' && key !== '_conflicts' && key !== '_revisions') {
            cleaned[key === '_id' ? 'id' : key] = value;
          }
        }

        if (!cleaned.id && docId) {
          cleaned.id = docId;
        }

        documents.push(cleaned);
        imported++;
      }

      const convertedCollections: CollectionExport[] = [{ name: collectionName, documents }];

      return {
        imported,
        skipped,
        errors,
        sourceFormat: 'pouchdb',
        collections: [collectionName],
        convertedCollections,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      errors.push({ collection: '', message: `PouchDB import error: ${message}` });
      return {
        imported: 0,
        skipped: 0,
        errors,
        sourceFormat: 'pouchdb',
        collections: [],
        convertedCollections: [],
      };
    }
  }

  function importFromFirestore(data: string): CompetitorImportResult {
    const errors: ImportError[] = [];
    const convertedCollections: CollectionExport[] = [];
    let imported = 0;

    try {
      const parsed = JSON.parse(data) as FirestoreExport;

      function convertDoc(doc: FirestoreDoc): Record<string, unknown> {
        const result: Record<string, unknown> = {};
        if (doc.name) {
          const parts = doc.name.split('/');
          result.id = parts[parts.length - 1];
        }
        if (doc.fields) {
          for (const [key, value] of Object.entries(doc.fields)) {
            result[key] = convertFirestoreValue(value);
          }
        }
        if (doc.createTime) result._createdAt = doc.createTime;
        if (doc.updateTime) result._updatedAt = doc.updateTime;
        return result;
      }

      // Handle flat document array
      if (Array.isArray(parsed.documents)) {
        const docs = parsed.documents.map(convertDoc);
        convertedCollections.push({ name: 'imported', documents: docs });
        imported += docs.length;
      }

      // Handle collections-based structure
      if (parsed.collections && typeof parsed.collections === 'object') {
        for (const [name, col] of Object.entries(parsed.collections)) {
          const docs = (col.documents ?? []).map(convertDoc);
          convertedCollections.push({ name, documents: docs });
          imported += docs.length;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      errors.push({ collection: '', message: `Firestore import error: ${message}` });
    }

    return {
      imported,
      skipped: 0,
      errors,
      sourceFormat: 'firestore',
      collections: convertedCollections.map((c) => c.name),
      convertedCollections,
    };
  }

  function importAuto(data: string): CompetitorImportResult {
    const format = detectFormat(data);

    switch (format) {
      case 'rxdb':
        return importFromRxDB(data);
      case 'pouchdb':
        return importFromPouchDB(data);
      case 'firestore':
        return importFromFirestore(data);
      default:
        return {
          imported: 0,
          skipped: 0,
          errors: [{ collection: '', message: 'Unable to detect source format' }],
          sourceFormat: 'unknown',
          collections: [],
          convertedCollections: [],
        };
    }
  }

  return { detectFormat, importFromRxDB, importFromPouchDB, importFromFirestore, importAuto };
}
