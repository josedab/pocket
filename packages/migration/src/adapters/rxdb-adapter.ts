/**
 * RxDBAdapter - Migration adapter for RxDB databases.
 *
 * Handles RxDB-style data with collections containing JSON schemas
 * and document arrays. Maps RxDB JSON Schema definitions to Pocket
 * field types and strips RxDB metadata fields (`_meta`, `_deleted`, `_rev`).
 *
 * @module rxdb-adapter
 */

import type {
  CollectionMapping,
  FieldMapping,
  SourceAnalysis,
  SourceDocument,
} from '../types.js';
import { MigrationAdapter, type GetDocumentsOptions } from './base-adapter.js';

/**
 * RxDB JSON Schema property definition.
 */
interface RxDBSchemaProperty {
  type?: string;
  format?: string;
  items?: RxDBSchemaProperty;
  properties?: Record<string, RxDBSchemaProperty>;
  ref?: string;
  default?: unknown;
}

/**
 * RxDB collection schema definition.
 */
interface RxDBSchema {
  title?: string;
  version?: number;
  primaryKey?: string;
  type?: string;
  properties?: Record<string, RxDBSchemaProperty>;
  required?: string[];
  indexes?: (string | string[])[];
}

/**
 * RxDB collection data format.
 */
interface RxDBCollection {
  schema?: RxDBSchema;
  docs: Record<string, unknown>[];
}

/**
 * RxDB data format accepted by the adapter.
 *
 * @example
 * ```typescript
 * const data: RxDBData = {
 *   collections: {
 *     todos: {
 *       schema: {
 *         title: 'todo',
 *         version: 0,
 *         primaryKey: 'id',
 *         properties: {
 *           id: { type: 'string' },
 *           title: { type: 'string' },
 *           done: { type: 'boolean' }
 *         }
 *       },
 *       docs: [
 *         { id: 'todo-1', title: 'Buy milk', done: false }
 *       ]
 *     }
 *   }
 * };
 * ```
 */
export interface RxDBData {
  /** Map of collection names to their schemas and documents */
  collections: Record<string, RxDBCollection>;
}

/** RxDB metadata fields to strip during migration */
const RXDB_META_FIELDS = ['_meta', '_deleted', '_rev', '_attachments'];

/**
 * Migration adapter for RxDB databases.
 *
 * Reads collection schemas and documents from RxDB export format,
 * maps JSON Schema types to Pocket types, and strips RxDB internal metadata.
 *
 * @example
 * ```typescript
 * const adapter = createRxDBAdapter(rxdbExportData);
 * const analysis = await adapter.analyze();
 * const collections = await adapter.getCollections();
 * ```
 *
 * @see {@link MigrationAdapter}
 */
export class RxDBAdapter extends MigrationAdapter {
  /** @inheritdoc */
  readonly source = 'rxdb' as const;

  private readonly data: RxDBData;
  private readonly processedDocs = new Map<string, SourceDocument[]>();

  /**
   * Creates a new RxDBAdapter.
   *
   * @param data - RxDB export data with collections, schemas, and documents
   */
  constructor(data: RxDBData) {
    super();
    this.data = data;
    this.processCollections();
  }

  /** @inheritdoc */
  async analyze(): Promise<SourceAnalysis> {
    const collections = Object.keys(this.data.collections);
    let totalDocuments = 0;
    let estimatedSize = 0;

    for (const [, docs] of this.processedDocs) {
      totalDocuments += docs.length;
      estimatedSize += JSON.stringify(docs).length;
    }

    return {
      collections,
      totalDocuments,
      estimatedSizeBytes: estimatedSize,
    };
  }

  /** @inheritdoc */
  async getCollections(): Promise<string[]> {
    return Object.keys(this.data.collections);
  }

  /** @inheritdoc */
  async getDocuments(
    collection: string,
    options?: GetDocumentsOptions,
  ): Promise<SourceDocument[]> {
    const docs = this.processedDocs.get(collection) ?? [];
    const skip = options?.skip ?? 0;
    const limit = options?.limit ?? docs.length;
    return docs.slice(skip, skip + limit);
  }

  /** @inheritdoc */
  async getDocumentCount(collection: string): Promise<number> {
    return this.processedDocs.get(collection)?.length ?? 0;
  }

  /** @inheritdoc */
  async getSchema(collection: string): Promise<CollectionMapping> {
    const collectionData = this.data.collections[collection];
    const schema = collectionData?.schema;
    const fieldMappings: FieldMapping[] = [];

    if (schema?.properties) {
      const primaryKey = schema.primaryKey ?? 'id';
      for (const [fieldName, prop] of Object.entries(schema.properties)) {
        if (fieldName === primaryKey) continue;
        if (RXDB_META_FIELDS.includes(fieldName)) continue;

        fieldMappings.push({
          sourceField: fieldName,
          targetField: fieldName,
          type: this.mapRxDBType(prop),
          defaultValue: prop.default,
        });
      }
    } else {
      // Infer from first document
      const docs = this.processedDocs.get(collection) ?? [];
      const sample = docs[0] ?? {};
      return {
        sourceCollection: collection,
        targetCollection: collection,
        fieldMappings: this.inferFieldMappings(sample, ['_id', '_meta']),
      };
    }

    return {
      sourceCollection: collection,
      targetCollection: collection,
      fieldMappings,
    };
  }

  /**
   * Maps an RxDB JSON Schema type to a Pocket field type.
   */
  private mapRxDBType(prop: RxDBSchemaProperty): string {
    if (prop.ref) return 'string'; // References stored as IDs
    if (prop.format === 'date-time') return 'datetime';

    switch (prop.type) {
      case 'string':
        return 'string';
      case 'number':
      case 'integer':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'array':
        return 'array';
      case 'object':
        return 'object';
      default:
        return 'string';
    }
  }

  /**
   * Processes all collections and caches cleaned documents.
   */
  private processCollections(): void {
    for (const [name, collection] of Object.entries(this.data.collections)) {
      const primaryKey = collection.schema?.primaryKey ?? 'id';
      const docs: SourceDocument[] = [];

      for (const rawDoc of collection.docs) {
        // Skip soft-deleted documents
        if (rawDoc._deleted === true) continue;

        const doc = { ...rawDoc };
        const meta: Record<string, unknown> = {};

        // Move RxDB metadata to _meta
        for (const field of RXDB_META_FIELDS) {
          if (field in doc) {
            meta[field] = doc[field];
            delete doc[field];
          }
        }

        const id = (doc[primaryKey] as string) ?? String(Math.random());
        if (primaryKey !== '_id') {
          delete doc[primaryKey];
        }

        docs.push({
          _id: id,
          _meta: Object.keys(meta).length > 0 ? meta : undefined,
          ...doc,
        });
      }

      this.processedDocs.set(name, docs);
    }
  }
}

/**
 * Creates a new RxDB migration adapter.
 *
 * @param data - RxDB export data with collections, schemas, and documents
 * @returns A configured RxDBAdapter instance
 *
 * @example
 * ```typescript
 * const adapter = createRxDBAdapter({
 *   collections: {
 *     users: {
 *       schema: { primaryKey: 'id', properties: { id: { type: 'string' }, name: { type: 'string' } } },
 *       docs: [{ id: 'u1', name: 'Alice' }]
 *     }
 *   }
 * });
 * ```
 */
export function createRxDBAdapter(data: RxDBData): RxDBAdapter {
  return new RxDBAdapter(data);
}
