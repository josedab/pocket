import type { Database, Document, NormalizedIndex } from '@pocket/core';
import type { CollectionInfo, IndexInfo, QueryResult, StudioQueryPlan } from './types.js';

/**
 * Database Inspector for browsing and querying Pocket databases.
 *
 * Provides read-only introspection of collections, documents, and indexes.
 * Used by the Studio server to power the REST API and by consumers
 * who need programmatic database inspection.
 *
 * @example
 * ```typescript
 * const inspector = createDatabaseInspector(db);
 *
 * const collections = await inspector.listCollections();
 * const users = await inspector.getCollection('users');
 * console.log(`Users: ${users.documentCount} documents`);
 *
 * const result = await inspector.queryDocuments('users', { active: true }, undefined, 10);
 * console.log(`Found ${result.totalCount} active users`);
 * ```
 *
 * @see {@link createDatabaseInspector} for the factory function
 */
export class DatabaseInspector {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * List all collections in the database with metadata.
   *
   * @returns Array of CollectionInfo objects for each collection
   */
  async listCollections(): Promise<CollectionInfo[]> {
    const names = await this.db.listCollections();
    const infos: CollectionInfo[] = [];

    for (const name of names) {
      const info = await this.getCollection(name);
      infos.push(info);
    }

    return infos;
  }

  /**
   * Get detailed information about a specific collection.
   *
   * Includes document count, index count, storage estimation,
   * and a sample document for schema inference.
   *
   * @param name - The collection name
   * @returns Collection information with a sample document
   */
  async getCollection(name: string): Promise<CollectionInfo> {
    const collection = this.db.collection(name);
    const documentCount = await collection.count();
    const indexes = await collection.getIndexes();

    // Get a sample document for schema inference
    const sampleDocs = await collection.find().limit(1).exec();
    const sampleDocument = sampleDocs.length > 0 ? sampleDocs[0] : undefined;

    // Estimate storage size: rough estimate based on JSON serialization
    let storageSize = 0;
    let lastModified = 0;

    if (sampleDocument) {
      const avgDocSize = JSON.stringify(sampleDocument).length;
      storageSize = avgDocSize * documentCount;
      lastModified = (sampleDocument)._updatedAt ?? 0;
    }

    // Try to find actual lastModified by checking the most recent document
    const recentDocs = await collection
      .find()
      .sort('_updatedAt', 'desc')
      .limit(1)
      .exec();
    if (recentDocs.length > 0) {
      lastModified = (recentDocs[0]!)._updatedAt ?? lastModified;
    }

    return {
      name,
      documentCount,
      indexCount: indexes.length,
      storageSize,
      lastModified,
      sampleDocument,
    };
  }

  /**
   * Get a single document by ID from a collection.
   *
   * @param collection - The collection name
   * @param id - The document ID
   * @returns The document, or null if not found
   */
  async getDocument(collection: string, id: string): Promise<unknown> {
    const coll = this.db.collection(collection);
    return coll.get(id);
  }

  /**
   * Query documents in a collection with optional filter, sort, and limit.
   *
   * @param collection - The collection name
   * @param filter - Optional filter object (field equality matching)
   * @param sort - Optional sort specification (e.g., \{ name: 'asc' \})
   * @param limit - Maximum number of documents to return
   * @returns Query result with documents, count, and timing
   */
  async queryDocuments(
    collection: string,
    filter?: Record<string, unknown>,
    sort?: Record<string, 'asc' | 'desc'>,
    limit?: number
  ): Promise<QueryResult> {
    const coll = this.db.collection(collection);
    const startTime = performance.now();

    let queryBuilder = coll.find(filter as Partial<Document> | undefined);

    if (sort) {
      for (const [field, direction] of Object.entries(sort)) {
        queryBuilder = queryBuilder.sort(field as keyof Document & string, direction);
      }
    }

    // Get total count before limiting
    const totalCount = await coll.count(filter as Partial<Document> | undefined);

    if (limit !== undefined && limit > 0) {
      queryBuilder = queryBuilder.limit(limit);
    }

    const documents = await queryBuilder.exec();
    const executionTimeMs = performance.now() - startTime;

    // Build a simple query plan
    const indexes = await coll.getIndexes();
    const queryPlan = this.buildQueryPlan(collection, filter, indexes);

    return {
      documents,
      totalCount,
      executionTimeMs,
      queryPlan,
    };
  }

  /**
   * Explain how a query would be executed without running it.
   *
   * Returns a query plan showing the strategy, index usage,
   * and estimated cost.
   *
   * @param collection - The collection name
   * @param filter - The filter to explain
   * @returns The query execution plan
   */
  async explainQuery(
    collection: string,
    filter: Record<string, unknown>
  ): Promise<StudioQueryPlan> {
    const coll = this.db.collection(collection);
    const indexes = await coll.getIndexes();
    return this.buildQueryPlan(collection, filter, indexes);
  }

  /**
   * Count documents in a collection, optionally matching a filter.
   *
   * @param collection - The collection name
   * @param filter - Optional filter for counting matching documents
   * @returns The number of matching documents
   */
  async countDocuments(
    collection: string,
    filter?: Record<string, unknown>
  ): Promise<number> {
    const coll = this.db.collection(collection);
    return coll.count(filter as Partial<Document> | undefined);
  }

  /**
   * Get all indexes defined on a collection.
   *
   * @param collection - The collection name
   * @returns Array of index information
   */
  async getIndexes(collection: string): Promise<IndexInfo[]> {
    const coll = this.db.collection(collection);
    const indexes = await coll.getIndexes();

    return indexes.map((idx) => ({
      name: idx.name,
      fields: idx.fields.map((f) => f.field),
      unique: idx.unique,
      sparse: idx.sparse,
    }));
  }

  /**
   * Build a query plan for a given filter and available indexes.
   *
   * @param collection - The collection name
   * @param filter - The filter to analyze
   * @param indexes - Available indexes on the collection
   * @returns The generated query plan
   */
  private buildQueryPlan(
    collection: string,
    filter: Record<string, unknown> | undefined,
    indexes: NormalizedIndex[]
  ): StudioQueryPlan {
    if (!filter || Object.keys(filter).length === 0) {
      return {
        collection,
        strategy: 'full-scan',
        estimatedCost: Infinity,
        filters: [],
      };
    }

    const filterFields = Object.keys(filter);
    const filters = filterFields.map((field) => {
      const value = filter[field];
      if (typeof value === 'object' && value !== null) {
        const ops = Object.keys(value);
        return `${field} ${ops.join(', ')}`;
      }
      return `${field} = ${JSON.stringify(value)}`;
    });

    // Check if filter is an ID lookup
    if (filterFields.length === 1 && filterFields[0] === '_id') {
      return {
        collection,
        strategy: 'id-lookup',
        estimatedCost: 1,
        filters,
      };
    }

    // Try to find a matching index
    for (const index of indexes) {
      const indexFields = index.fields.map((f) => f.field);
      const matchedFields = filterFields.filter((f) => indexFields.includes(f));

      if (matchedFields.length > 0) {
        // Calculate how well the index covers the filter
        const coverageRatio = matchedFields.length / filterFields.length;
        const estimatedCost = Math.round(1000 * (1 - coverageRatio * 0.9));

        return {
          collection,
          strategy: 'index-scan',
          indexUsed: index.name,
          estimatedCost,
          filters,
        };
      }
    }

    // No matching index found - full scan
    return {
      collection,
      strategy: 'full-scan',
      estimatedCost: Infinity,
      filters,
    };
  }
}

/**
 * Create a new DatabaseInspector instance.
 *
 * @param db - The Pocket Database instance to inspect
 * @returns A new DatabaseInspector
 *
 * @example
 * ```typescript
 * import { createDatabaseInspector } from '@pocket/studio';
 *
 * const inspector = createDatabaseInspector(db);
 * const collections = await inspector.listCollections();
 * ```
 */
export function createDatabaseInspector(db: Database): DatabaseInspector {
  return new DatabaseInspector(db);
}
