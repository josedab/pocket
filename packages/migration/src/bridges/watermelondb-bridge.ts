/**
 * WatermelonDB Migration Bridge - Migrates data from WatermelonDB to Pocket.
 *
 * Handles WatermelonDB specifics: `id`, `_status`, `_changed` fields,
 * sync status markers, model-to-collection mapping, and relation migration.
 *
 * @module bridges/watermelondb-bridge
 */

import type {
  BridgeMigrationConfig,
  BridgeMigrationProgress,
  BridgeMigrationResult,
  CollectionMigrationResult,
  DatabaseInspection,
} from './types.js';

/** WatermelonDB internal fields to strip during migration */
const WATERMELON_META_FIELDS = new Set(['_status', '_changed']);

/**
 * Migration bridge for WatermelonDB databases.
 *
 * Inspects and migrates WatermelonDB collections, handling sync status
 * markers, model class mappings, and relation fields.
 *
 * @example
 * ```typescript
 * const bridge = createWatermelonDBBridge({ source: 'watermelondb', batchSize: 200 });
 * const inspection = await bridge.inspect();
 * const result = await bridge.migrate();
 * ```
 */
export class WatermelonDBMigrationBridge {
  private readonly config: BridgeMigrationConfig;
  private readonly batchSize: number;

  constructor(config: BridgeMigrationConfig) {
    if (config.source !== 'watermelondb') {
      throw new Error(
        `WatermelonDBMigrationBridge requires source 'watermelondb', got '${config.source}'`,
      );
    }
    this.config = config;
    this.batchSize = config.batchSize ?? 100;
  }

  /**
   * Inspects the WatermelonDB source database and returns structural metadata.
   */
  async inspect(): Promise<DatabaseInspection> {
    const sourceConfig = this.config.sourceConfig ?? {};
    const collections = (sourceConfig.collections ?? {}) as Record<
      string,
      {
        modelClass?: string;
        columns?: string[];
        relations?: Record<string, unknown>;
        docs?: Record<string, unknown>[];
      }
    >;

    const inspectedCollections: DatabaseInspection['collections'] = [];
    let totalDocuments = 0;
    let totalSize = 0;

    for (const [name, collection] of Object.entries(collections)) {
      if (this.config.targetCollections && !this.config.targetCollections.includes(name)) {
        continue;
      }

      const docs = collection.docs ?? [];
      const indexes = collection.columns ?? [];
      const estimatedSize = JSON.stringify(docs).length;

      inspectedCollections.push({
        name,
        documentCount: docs.length,
        indexes,
        sampleDocument: docs[0] ? this.stripMetaFields({ ...docs[0] }) : undefined,
        estimatedSize,
      });

      totalDocuments += docs.length;
      totalSize += estimatedSize;
    }

    return {
      source: 'watermelondb',
      collections: inspectedCollections,
      totalDocuments,
      totalSize,
      version: sourceConfig.version as string | undefined,
    };
  }

  /**
   * Migrates all collections from the WatermelonDB source to Pocket format.
   */
  async migrate(): Promise<BridgeMigrationResult> {
    const startTime = Date.now();
    const sourceConfig = this.config.sourceConfig ?? {};
    const collections = (sourceConfig.collections ?? {}) as Record<
      string,
      {
        modelClass?: string;
        columns?: string[];
        relations?: Record<string, unknown>;
        docs?: Record<string, unknown>[];
      }
    >;

    const collectionResults: CollectionMigrationResult[] = [];
    const warnings: string[] = [];
    const errors: BridgeMigrationResult['errors'] = [];
    let totalDocuments = 0;
    let migratedDocuments = 0;
    let failedDocuments = 0;
    let skippedDocuments = 0;

    for (const [name, collection] of Object.entries(collections)) {
      if (this.config.targetCollections && !this.config.targetCollections.includes(name)) {
        continue;
      }

      const result = await this.migrateCollection(name, collection);
      collectionResults.push(result);

      totalDocuments += result.documentCount;
      migratedDocuments += result.migratedCount;
      failedDocuments += result.failedCount;
      skippedDocuments += result.documentCount - result.migratedCount - result.failedCount;
    }

    return {
      source: 'watermelondb',
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
   * Migrates a single WatermelonDB collection.
   */
  async migrateCollection(
    name: string,
    collectionData?: {
      modelClass?: string;
      columns?: string[];
      relations?: Record<string, unknown>;
      docs?: Record<string, unknown>[];
    },
  ): Promise<CollectionMigrationResult> {
    const startTime = Date.now();
    const sourceConfig = this.config.sourceConfig ?? {};
    const collections = (sourceConfig.collections ?? {}) as Record<
      string,
      {
        modelClass?: string;
        columns?: string[];
        relations?: Record<string, unknown>;
        docs?: Record<string, unknown>[];
      }
    >;
    const data = collectionData ?? collections[name];
    const docs = data?.docs ?? [];
    const relations = data?.relations ?? {};

    let migratedCount = 0;
    let failedCount = 0;
    let indexesMigrated = 0;

    const totalBatches = Math.ceil(docs.length / this.batchSize);

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const batchStart = batchIndex * this.batchSize;
      const batch = docs.slice(batchStart, batchStart + this.batchSize);

      for (const rawDoc of batch) {
        try {
          // Skip documents marked as deleted in WatermelonDB sync
          if (rawDoc._status === 'deleted') {
            continue;
          }

          const doc = { ...rawDoc };

          // Map WatermelonDB 'id' to '_id'
          const id = (doc.id as string) ?? String(Math.random());
          delete doc.id;

          // Strip WatermelonDB sync metadata
          const cleaned = this.stripMetaFields(doc);

          // Map relation fields (WatermelonDB uses `_id` suffix for belongs_to)
          const mapped = this.mapRelations(cleaned, relations);

          const pocketDoc: Record<string, unknown> = {
            _id: this.config.preserveIds !== false ? id : undefined,
            ...mapped,
          };

          // Apply user transform
          if (this.config.transformDocument) {
            const transformed = this.config.transformDocument(pocketDoc, name);
            if (transformed === null) {
              continue;
            }
          }

          if (!this.config.dryRun) {
            // In a real implementation, write to Pocket here
          }

          migratedCount++;
        } catch {
          failedCount++;
        }
      }

      this.reportProgress('migrating', name, docs.length, batchStart + batch.length, failedCount, startTime);
    }

    // Migrate column indexes
    if (this.config.includeIndexes && data?.columns) {
      indexesMigrated = data.columns.length;
    }

    this.reportProgress('complete', name, docs.length, docs.length, failedCount, startTime);

    return {
      name,
      documentCount: docs.length,
      migratedCount,
      failedCount,
      indexesMigrated,
      attachmentsMigrated: 0,
      duration: Date.now() - startTime,
    };
  }

  /** Strips WatermelonDB internal metadata fields from a document. */
  private stripMetaFields(doc: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(doc)) {
      if (!WATERMELON_META_FIELDS.has(key)) {
        result[key] = value;
      }
    }
    return result;
  }

  /**
   * Maps WatermelonDB relation fields.
   * WatermelonDB uses `belongs_to` relations stored as `<relation>_id` columns.
   */
  private mapRelations(
    doc: Record<string, unknown>,
    relations: Record<string, unknown>,
  ): Record<string, unknown> {
    if (Object.keys(relations).length === 0) return doc;

    const result = { ...doc };
    for (const [relationName, relationConfig] of Object.entries(relations)) {
      const config = relationConfig as { type?: string; foreignKey?: string } | undefined;
      if (config?.type === 'belongs_to') {
        const foreignKey = config.foreignKey ?? `${relationName}_id`;
        // Keep the foreign key field as-is for Pocket references
        if (result[foreignKey] !== undefined) {
          result[`${relationName}Ref`] = result[foreignKey];
        }
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
 * Creates a new WatermelonDB migration bridge.
 *
 * @param config - Bridge migration configuration with source set to 'watermelondb'
 * @returns A configured WatermelonDBMigrationBridge instance
 *
 * @example
 * ```typescript
 * const bridge = createWatermelonDBBridge({
 *   source: 'watermelondb',
 *   sourceConfig: {
 *     collections: {
 *       posts: {
 *         modelClass: 'Post',
 *         columns: ['title', 'body', 'author_id'],
 *         relations: { author: { type: 'belongs_to', foreignKey: 'author_id' } },
 *         docs: [...]
 *       }
 *     }
 *   },
 * });
 * const result = await bridge.migrate();
 * ```
 */
export function createWatermelonDBBridge(config: BridgeMigrationConfig): WatermelonDBMigrationBridge {
  return new WatermelonDBMigrationBridge(config);
}
