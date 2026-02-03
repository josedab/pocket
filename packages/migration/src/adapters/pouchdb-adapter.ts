/**
 * PouchDBAdapter - Migration adapter for PouchDB / CouchDB data.
 *
 * Handles CouchDB-style documents with `_rev`, `_id`, `_attachments`,
 * and design documents. Accepts data in the PouchDB `allDocs` format
 * with `rows[].doc` entries.
 *
 * @module pouchdb-adapter
 */

import type {
  CollectionMapping,
  SourceAnalysis,
  SourceDocument,
} from '../types.js';
import { MigrationAdapter, type GetDocumentsOptions } from './base-adapter.js';

/**
 * PouchDB document row as returned by `allDocs({ include_docs: true })`.
 */
interface PouchDBRow {
  id: string;
  key: string;
  value: { rev: string };
  doc?: Record<string, unknown>;
}

/**
 * PouchDB data format accepted by the adapter.
 *
 * @example
 * ```typescript
 * const data: PouchDBData = {
 *   rows: [
 *     { id: 'todo-1', key: 'todo-1', value: { rev: '1-abc' }, doc: { _id: 'todo-1', title: 'Buy milk' } },
 *     { id: 'todo-2', key: 'todo-2', value: { rev: '1-def' }, doc: { _id: 'todo-2', title: 'Walk dog' } }
 *   ],
 *   total_rows: 2,
 *   offset: 0
 * };
 * ```
 */
export interface PouchDBData {
  /** Document rows from allDocs response */
  rows: PouchDBRow[];

  /** Total number of rows in the database */
  total_rows?: number;

  /** Row offset */
  offset?: number;

  /** Optional collection name override (PouchDB is single-collection) */
  collection?: string;
}

/** CouchDB metadata fields to strip during migration */
const COUCHDB_META_FIELDS = ['_rev', '_attachments', '_conflicts', '_revisions', '_revs_info'];

/**
 * Migration adapter for PouchDB / CouchDB databases.
 *
 * Reads data from PouchDB's `allDocs` format, strips CouchDB-specific
 * metadata, and skips design documents (`_design/`).
 *
 * @example
 * ```typescript
 * const adapter = createPouchDBAdapter(pouchDBExportData);
 * const analysis = await adapter.analyze();
 * const docs = await adapter.getDocuments('default');
 * ```
 *
 * @see {@link MigrationAdapter}
 */
export class PouchDBAdapter extends MigrationAdapter {
  /** @inheritdoc */
  readonly source = 'pouchdb' as const;

  private readonly data: PouchDBData;
  private readonly collectionName: string;
  private readonly documents: SourceDocument[];

  /**
   * Creates a new PouchDBAdapter.
   *
   * @param data - PouchDB allDocs-format export data
   */
  constructor(data: PouchDBData) {
    super();
    this.data = data;
    this.collectionName = data.collection ?? 'default';
    this.documents = this.extractDocuments();
  }

  /** @inheritdoc */
  async analyze(): Promise<SourceAnalysis> {
    const docs = this.documents;
    const estimatedSize = JSON.stringify(docs).length;

    return {
      collections: [this.collectionName],
      totalDocuments: docs.length,
      estimatedSizeBytes: estimatedSize,
    };
  }

  /** @inheritdoc */
  async getCollections(): Promise<string[]> {
    return [this.collectionName];
  }

  /** @inheritdoc */
  async getDocuments(
    _collection: string,
    options?: GetDocumentsOptions,
  ): Promise<SourceDocument[]> {
    const skip = options?.skip ?? 0;
    const limit = options?.limit ?? this.documents.length;
    return this.documents.slice(skip, skip + limit);
  }

  /** @inheritdoc */
  async getDocumentCount(_collection: string): Promise<number> {
    return this.documents.length;
  }

  /** @inheritdoc */
  async getSchema(collection: string): Promise<CollectionMapping> {
    const docs = this.documents;
    const sample = docs[0] ?? {};
    const fieldMappings = this.inferFieldMappings(sample, ['_id', '_meta']);

    return {
      sourceCollection: collection,
      targetCollection: this.collectionName,
      fieldMappings,
    };
  }

  /**
   * Extracts and cleans documents from PouchDB rows.
   * Skips design documents and strips CouchDB metadata.
   */
  private extractDocuments(): SourceDocument[] {
    const results: SourceDocument[] = [];

    for (const row of this.data.rows) {
      if (!row.doc) continue;
      // Skip design documents
      if (row.id.startsWith('_design/')) continue;

      const doc = { ...row.doc };
      const meta: Record<string, unknown> = {};

      // Move CouchDB metadata to _meta and strip from doc
      for (const field of COUCHDB_META_FIELDS) {
        if (field in doc) {
          meta[field] = doc[field];
          delete doc[field];
        }
      }

      const id = (doc._id as string) ?? row.id;
      delete doc._id;

      results.push({
        _id: id,
        _meta: Object.keys(meta).length > 0 ? meta : undefined,
        ...doc,
      });
    }

    return results;
  }
}

/**
 * Creates a new PouchDB migration adapter.
 *
 * @param data - PouchDB allDocs-format export data
 * @returns A configured PouchDBAdapter instance
 *
 * @example
 * ```typescript
 * const adapter = createPouchDBAdapter({
 *   rows: [
 *     { id: 'doc1', key: 'doc1', value: { rev: '1-abc' }, doc: { _id: 'doc1', name: 'Alice' } }
 *   ]
 * });
 * ```
 */
export function createPouchDBAdapter(data: PouchDBData): PouchDBAdapter {
  return new PouchDBAdapter(data);
}
