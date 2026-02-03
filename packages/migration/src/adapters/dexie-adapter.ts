/**
 * DexieAdapter - Migration adapter for Dexie.js databases.
 *
 * Handles Dexie-style data with tables and index definitions.
 * Maps Dexie index syntax (`++id`, `&email`, `*tags`) to Pocket
 * indexes and infers schema from sample documents.
 *
 * @module dexie-adapter
 */

import type {
  CollectionMapping,
  FieldMapping,
  SourceAnalysis,
  SourceDocument,
} from '../types.js';
import { MigrationAdapter, type GetDocumentsOptions } from './base-adapter.js';

/**
 * Dexie table data format.
 */
interface DexieTable {
  /** Dexie index definition string (e.g. '++id, &email, name, *tags') */
  schema?: string;

  /** Documents in the table */
  docs: Record<string, unknown>[];
}

/**
 * Dexie data format accepted by the adapter.
 *
 * @example
 * ```typescript
 * const data: DexieData = {
 *   tables: {
 *     friends: {
 *       schema: '++id, name, age, *tags',
 *       docs: [
 *         { id: 1, name: 'Alice', age: 30, tags: ['dev', 'js'] }
 *       ]
 *     }
 *   }
 * };
 * ```
 */
export interface DexieData {
  /** Map of table names to their schemas and documents */
  tables: Record<string, DexieTable>;
}

/**
 * Parsed Dexie index definition.
 */
interface ParsedIndex {
  /** Field name */
  field: string;

  /** Whether this is an auto-increment primary key (++) */
  autoIncrement: boolean;

  /** Whether this is a unique index (&) */
  unique: boolean;

  /** Whether this is a multi-entry index (*) */
  multiEntry: boolean;
}

/**
 * Migration adapter for Dexie.js databases.
 *
 * Reads table definitions and documents from Dexie export format,
 * parses Dexie index syntax, and infers Pocket schema from sample data.
 *
 * @example
 * ```typescript
 * const adapter = createDexieAdapter(dexieExportData);
 * const analysis = await adapter.analyze();
 * const docs = await adapter.getDocuments('friends');
 * ```
 *
 * @see {@link MigrationAdapter}
 */
export class DexieAdapter extends MigrationAdapter {
  /** @inheritdoc */
  readonly source = 'dexie' as const;

  private readonly data: DexieData;
  private readonly processedDocs = new Map<string, SourceDocument[]>();

  /**
   * Creates a new DexieAdapter.
   *
   * @param data - Dexie export data with tables and documents
   */
  constructor(data: DexieData) {
    super();
    this.data = data;
    this.processTables();
  }

  /** @inheritdoc */
  async analyze(): Promise<SourceAnalysis> {
    const collections = Object.keys(this.data.tables);
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
    return Object.keys(this.data.tables);
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
    const table = this.data.tables[collection];
    const fieldMappings: FieldMapping[] = [];
    const parsedIndexes = table?.schema ? this.parseIndexes(table.schema) : [];

    // Get a sample document for type inference
    const docs = this.processedDocs.get(collection) ?? [];
    const sample = docs[0];

    if (sample) {
      for (const [key, value] of Object.entries(sample)) {
        if (key === '_id' || key === '_meta') continue;

        const index = parsedIndexes.find((i) => i.field === key);
        const fieldType = index?.multiEntry ? 'array' : this.mapFieldType(value);

        fieldMappings.push({
          sourceField: key,
          targetField: key,
          type: fieldType,
        });
      }
    }

    return {
      sourceCollection: collection,
      targetCollection: collection,
      fieldMappings,
    };
  }

  /**
   * Parses a Dexie schema index definition string.
   *
   * Index syntax:
   * - `++field` - auto-increment primary key
   * - `&field` - unique index
   * - `*field` - multi-entry index (array field)
   * - `field` - regular index
   *
   * @param schema - Dexie schema string (e.g. '++id, &email, *tags')
   * @returns Parsed index definitions
   */
  private parseIndexes(schema: string): ParsedIndex[] {
    return schema
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map((part) => {
        let field = part;
        let autoIncrement = false;
        let unique = false;
        let multiEntry = false;

        if (field.startsWith('++')) {
          autoIncrement = true;
          field = field.slice(2);
        } else if (field.startsWith('&')) {
          unique = true;
          field = field.slice(1);
        } else if (field.startsWith('*')) {
          multiEntry = true;
          field = field.slice(1);
        }

        return { field, autoIncrement, unique, multiEntry };
      });
  }

  /**
   * Processes all tables and caches cleaned documents.
   */
  private processTables(): void {
    for (const [name, table] of Object.entries(this.data.tables)) {
      const parsedIndexes = table.schema ? this.parseIndexes(table.schema) : [];
      const primaryKeyIndex = parsedIndexes.find((i) => i.autoIncrement);
      const primaryKey = primaryKeyIndex?.field ?? 'id';
      const docs: SourceDocument[] = [];

      for (const rawDoc of table.docs) {
        const doc = { ...rawDoc };
        const id = String(doc[primaryKey] ?? Math.random());

        if (primaryKey !== '_id') {
          delete doc[primaryKey];
        }

        docs.push({
          _id: id,
          ...doc,
        });
      }

      this.processedDocs.set(name, docs);
    }
  }
}

/**
 * Creates a new Dexie migration adapter.
 *
 * @param data - Dexie export data with tables and documents
 * @returns A configured DexieAdapter instance
 *
 * @example
 * ```typescript
 * const adapter = createDexieAdapter({
 *   tables: {
 *     friends: {
 *       schema: '++id, name, age, *tags',
 *       docs: [{ id: 1, name: 'Alice', age: 30, tags: ['dev'] }]
 *     }
 *   }
 * });
 * ```
 */
export function createDexieAdapter(data: DexieData): DexieAdapter {
  return new DexieAdapter(data);
}
