/**
 * MigrationAdapter - Abstract base class for source database adapters.
 *
 * Each adapter provides a consistent interface for reading data from
 * a specific source database format. Subclasses implement the actual
 * extraction logic for PouchDB, RxDB, Dexie, and Firestore.
 *
 * @module base-adapter
 */

import type {
  CollectionMapping,
  FieldMapping,
  MigrationSource,
  SourceAnalysis,
  SourceDocument,
} from '../types.js';

/**
 * Options for paginated document retrieval.
 *
 * @see {@link MigrationAdapter.getDocuments}
 */
export interface GetDocumentsOptions {
  /** Maximum number of documents to retrieve */
  limit?: number;

  /** Number of documents to skip */
  skip?: number;
}

/**
 * Abstract base class for migration source adapters.
 *
 * Provides a common interface for analyzing and extracting data from
 * different source databases. Includes a utility method for inferring
 * Pocket field types from JavaScript values.
 *
 * @example Implementing a custom adapter
 * ```typescript
 * class MyAdapter extends MigrationAdapter {
 *   readonly source = 'pouchdb' as const;
 *
 *   async analyze(): Promise<SourceAnalysis> {
 *     // Analyze source structure
 *   }
 *
 *   async getCollections(): Promise<string[]> {
 *     // Return collection names
 *   }
 *
 *   // ... implement remaining abstract methods
 * }
 * ```
 *
 * @see {@link PouchDBAdapter}
 * @see {@link RxDBAdapter}
 * @see {@link DexieAdapter}
 * @see {@link FirestoreAdapter}
 */
export abstract class MigrationAdapter {
  /** The migration source type this adapter handles */
  abstract readonly source: MigrationSource;

  /**
   * Analyzes the source database structure and returns summary information.
   *
   * @returns Source analysis with collection names, document counts, and size estimates
   */
  abstract analyze(): Promise<SourceAnalysis>;

  /**
   * Returns the list of collection names in the source database.
   *
   * @returns Array of collection name strings
   */
  abstract getCollections(): Promise<string[]>;

  /**
   * Retrieves documents from a specific collection with optional pagination.
   *
   * @param collection - The collection to read from
   * @param options - Pagination options (limit, skip)
   * @returns Array of source documents
   */
  abstract getDocuments(
    collection: string,
    options?: GetDocumentsOptions,
  ): Promise<SourceDocument[]>;

  /**
   * Returns the total number of documents in a collection.
   *
   * @param collection - The collection to count
   * @returns Number of documents
   */
  abstract getDocumentCount(collection: string): Promise<number>;

  /**
   * Generates a collection mapping (schema) for a source collection.
   *
   * @param collection - The collection to generate schema for
   * @returns Collection mapping with field definitions
   */
  abstract getSchema(collection: string): Promise<CollectionMapping>;

  /**
   * Infers a Pocket field type string from a JavaScript value.
   *
   * @param value - The value to infer the type from
   * @returns A Pocket field type string
   *
   * @example
   * ```typescript
   * this.mapFieldType('hello');     // 'string'
   * this.mapFieldType(42);          // 'number'
   * this.mapFieldType(true);        // 'boolean'
   * this.mapFieldType([1, 2]);      // 'array'
   * this.mapFieldType({ a: 1 });    // 'object'
   * this.mapFieldType(null);        // 'string'
   * ```
   */
  protected mapFieldType(value: unknown): string {
    if (value === null || value === undefined) {
      return 'string';
    }
    if (Array.isArray(value)) {
      return 'array';
    }
    if (value instanceof Date) {
      return 'datetime';
    }
    switch (typeof value) {
      case 'string':
        return 'string';
      case 'number':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'object':
        return 'object';
      default:
        return 'string';
    }
  }

  /**
   * Infers field mappings from a sample document.
   *
   * @param doc - A sample source document
   * @param skipFields - Fields to exclude from mapping
   * @returns Array of field mappings
   */
  protected inferFieldMappings(
    doc: Record<string, unknown>,
    skipFields: string[] = [],
  ): FieldMapping[] {
    const mappings: FieldMapping[] = [];
    for (const [key, value] of Object.entries(doc)) {
      if (skipFields.includes(key)) continue;
      mappings.push({
        sourceField: key,
        targetField: key,
        type: this.mapFieldType(value),
      });
    }
    return mappings;
  }
}
