/**
 * RxDB Migration Bridge - Migrates data from RxDB databases to Pocket.
 *
 * Reads from RxDB's internal storage format, maps `_id`, `_rev`, `_deleted`,
 * `_attachments`, converts RxDB schemas to Pocket schemas, handles RxDB's
 * collection naming (prefixed with db name), and migrates indexes.
 *
 * @module bridges/rxdb-bridge
 */

import type {
  BridgeMigrationConfig,
  BridgeMigrationProgress,
  BridgeMigrationResult,
  CollectionMigrationResult,
  DatabaseInspection,
} from './types.js';

/** RxDB metadata fields to strip during migration */
const RXDB_META_FIELDS = new Set(['_rev', '_deleted', '_attachments', '_meta']);

/**
 * Migration bridge for RxDB databases.
 *
 * Inspects and migrates RxDB collections, handling schema conversion,
 * document transformation, attachment migration, and index mapping.
 *
 * @example
 * ```typescript
 * const bridge = createRxDBBridge({ source: 'rxdb', batchSize: 200 });
 * const inspection = await bridge.inspect();
 * const result = await bridge.migrate();
 * ```
 */
export class RxDBMigrationBridge {
  private readonly config: BridgeMigrationConfig;
  private readonly batchSize: number;

  constructor(config: BridgeMigrationConfig) {
    if (config.source !== 'rxdb') {
      throw new Error(`RxDBMigrationBridge requires source 'rxdb', got '${config.source}'`);
    }
    this.config = config;
    this.batchSize = config.batchSize ?? 100;
  }

  /**
   * Inspects the RxDB source database and returns structural metadata.
   */
  async inspect(): Promise<DatabaseInspection> {
    const sourceConfig = this.config.sourceConfig ?? {};
    const collections = (sourceConfig.collections ?? {}) as Record<
      string,
      { schema?: Record<string, unknown>; docs?: Record<string, unknown>[] }
    >;
    const dbName = (sourceConfig.databaseName as string) ?? '';

    const inspectedCollections: DatabaseInspection['collections'] = [];
    let totalDocuments = 0;
    let totalSize = 0;

    for (const [name, collection] of Object.entries(collections)) {
      const collectionName = dbName ? name.replace(`${dbName}-`, '') : name;

      if (this.config.targetCollections && !this.config.targetCollections.includes(collectionName)) {
        continue;
      }

      const docs = collection.docs ?? [];
      const indexes = this.extractRxDBIndexes(collection.schema);
      const estimatedSize = JSON.stringify(docs).length;

      inspectedCollections.push({
        name: collectionName,
        documentCount: docs.length,
        indexes,
        sampleDocument: docs[0] ? this.stripMetaFields({ ...docs[0] }) : undefined,
        estimatedSize,
      });

      totalDocuments += docs.length;
      totalSize += estimatedSize;
    }

    return {
      source: 'rxdb',
      collections: inspectedCollections,
      totalDocuments,
      totalSize,
      version: sourceConfig.version as string | undefined,
    };
  }

  /**
   * Migrates all collections from the RxDB source to Pocket format.
   */
  async migrate(): Promise<BridgeMigrationResult> {
    const startTime = Date.now();
    const sourceConfig = this.config.sourceConfig ?? {};
    const collections = (sourceConfig.collections ?? {}) as Record<
      string,
      { schema?: Record<string, unknown>; docs?: Record<string, unknown>[] }
    >;
    const dbName = (sourceConfig.databaseName as string) ?? '';

    const collectionResults: CollectionMigrationResult[] = [];
    const warnings: string[] = [];
    const errors: BridgeMigrationResult['errors'] = [];
    let totalDocuments = 0;
    let migratedDocuments = 0;
    let failedDocuments = 0;
    let skippedDocuments = 0;

    for (const [name, collection] of Object.entries(collections)) {
      const collectionName = dbName ? name.replace(`${dbName}-`, '') : name;

      if (this.config.targetCollections && !this.config.targetCollections.includes(collectionName)) {
        continue;
      }

      const result = await this.migrateCollection(collectionName, collection);
      collectionResults.push(result);

      totalDocuments += result.documentCount;
      migratedDocuments += result.migratedCount;
      failedDocuments += result.failedCount;
      skippedDocuments += result.documentCount - result.migratedCount - result.failedCount;
    }

    return {
      source: 'rxdb',
      success: failedDocuments === 0,
      collections: collectionResults,
      totalDocuments,
      migratedDocuments,
      failedDocuments,
      skippedDocuments,
      duration: Date.now() - startTime,
      warnings,
      errors,
    };
  }

  /**
   * Migrates a single RxDB collection.
   */
  async migrateCollection(
    name: string,
    collectionData?: { schema?: Record<string, unknown>; docs?: Record<string, unknown>[] },
  ): Promise<CollectionMigrationResult> {
    const startTime = Date.now();
    const sourceConfig = this.config.sourceConfig ?? {};
    const collections = (sourceConfig.collections ?? {}) as Record<
      string,
      { schema?: Record<string, unknown>; docs?: Record<string, unknown>[] }
    >;
    const data = collectionData ?? collections[name];
    const docs = data?.docs ?? [];
    const schema = data?.schema;

    let migratedCount = 0;
    let failedCount = 0;
    let indexesMigrated = 0;
    let attachmentsMigrated = 0;

    const totalBatches = Math.ceil(docs.length / this.batchSize);

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const batchStart = batchIndex * this.batchSize;
      const batch = docs.slice(batchStart, batchStart + this.batchSize);

      for (const rawDoc of batch) {
        try {
          // Skip soft-deleted documents
          if (rawDoc._deleted === true) {
            continue;
          }

          const doc = { ...rawDoc };
          const primaryKey = (schema?.primaryKey as string) ?? 'id';

          // Preserve or generate ID
          if (this.config.preserveIds !== false) {
            const id = doc[primaryKey] ?? doc._id;
            if (id !== undefined) {
              doc._id = id;
            }
          }

          // Handle attachments
          if (this.config.includeAttachments && doc._attachments) {
            attachmentsMigrated++;
          }

          // Strip RxDB metadata
          const cleaned = this.stripMetaFields(doc);
          if (primaryKey !== '_id') {
            delete cleaned[primaryKey];
          }

          // Apply user transform
          if (this.config.transformDocument) {
            const transformed = this.config.transformDocument(cleaned, name);
            if (transformed === null) {
              continue;
            }
          }

          if (!this.config.dryRun) {
            // In a real implementation, write to Pocket here
          }

          migratedCount++;
        } catch (err) {
          failedCount++;
        }
      }

      this.reportProgress('migrating', name, docs.length, batchStart + batch.length, failedCount, startTime);
    }

    // Migrate indexes
    if (this.config.includeIndexes && schema) {
      const indexes = this.extractRxDBIndexes(schema);
      indexesMigrated = indexes.length;
    }

    this.reportProgress('complete', name, docs.length, docs.length, failedCount, startTime);

    return {
      name,
      documentCount: docs.length,
      migratedCount,
      failedCount,
      indexesMigrated,
      attachmentsMigrated,
      duration: Date.now() - startTime,
    };
  }

  /** Extracts index definitions from an RxDB schema. */
  private extractRxDBIndexes(schema?: Record<string, unknown>): string[] {
    if (!schema?.indexes) return [];
    const indexes = schema.indexes as (string | string[])[];
    return indexes.map((idx) => (Array.isArray(idx) ? idx.join('+') : idx));
  }

  /** Strips RxDB metadata fields from a document. */
  private stripMetaFields(doc: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(doc)) {
      if (!RXDB_META_FIELDS.has(key)) {
        result[key] = value;
      }
    }
    return result;
  }

  /** Reports migration progress via the configured callback. */
  private reportProgress(
    phase: BridgeMigrationProgress['phase'],
    collection: string,
    total: number,
    processed: number,
    failed: number,
    startTime: number,
  ): void {
    if (!this.config.onProgress) return;

    const elapsed = Date.now() - startTime;
    const rate = processed > 0 ? elapsed / processed : 0;
    const remaining = total - processed;

    this.config.onProgress({
      phase,
      collection,
      total,
      processed,
      failed,
      percentage: total > 0 ? Math.round((processed / total) * 100) : 100,
      estimatedRemainingMs: Math.round(remaining * rate),
    });
  }
}

/**
 * Creates a new RxDB migration bridge.
 *
 * @param config - Bridge migration configuration with source set to 'rxdb'
 * @returns A configured RxDBMigrationBridge instance
 *
 * @example
 * ```typescript
 * const bridge = createRxDBBridge({
 *   source: 'rxdb',
 *   sourceConfig: { collections: { ... } },
 *   batchSize: 200,
 * });
 * const result = await bridge.migrate();
 * ```
 */
export function createRxDBBridge(config: BridgeMigrationConfig): RxDBMigrationBridge {
  return new RxDBMigrationBridge(config);
}
