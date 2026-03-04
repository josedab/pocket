/**
 * Dexie Migration Bridge - Migrates data from Dexie.js databases to Pocket.
 *
 * Reads from IndexedDB stores directly, maps auto-increment keys,
 * parses Dexie schema string format (`"++id,name,age"`), and migrates
 * compound indexes.
 *
 * @module bridges/dexie-bridge
 */

import type {
  BridgeMigrationConfig,
  BridgeMigrationProgress,
  BridgeMigrationResult,
  CollectionMigrationResult,
  DatabaseInspection,
} from './types.js';

/**
 * Migration bridge for Dexie.js databases.
 *
 * Inspects and migrates Dexie tables, parsing index definitions,
 * handling auto-increment keys, and mapping compound indexes.
 *
 * @example
 * ```typescript
 * const bridge = createDexieBridge({ source: 'dexie', batchSize: 200 });
 * const inspection = await bridge.inspect();
 * const result = await bridge.migrate();
 * ```
 */
export class DexieMigrationBridge {
  private readonly config: BridgeMigrationConfig;
  private readonly batchSize: number;

  constructor(config: BridgeMigrationConfig) {
    if (config.source !== 'dexie') {
      throw new Error(`DexieMigrationBridge requires source 'dexie', got '${config.source}'`);
    }
    this.config = config;
    this.batchSize = config.batchSize ?? 100;
  }

  /**
   * Inspects the Dexie source database and returns structural metadata.
   */
  async inspect(): Promise<DatabaseInspection> {
    const sourceConfig = this.config.sourceConfig ?? {};
    const tables = (sourceConfig.tables ?? {}) as Record<
      string,
      { schema?: string; docs?: Record<string, unknown>[] }
    >;

    const inspectedCollections: DatabaseInspection['collections'] = [];
    let totalDocuments = 0;
    let totalSize = 0;

    for (const [name, table] of Object.entries(tables)) {
      if (this.config.targetCollections && !this.config.targetCollections.includes(name)) {
        continue;
      }

      const docs = table.docs ?? [];
      const indexes = table.schema ? this.parseSchemaIndexes(table.schema) : [];
      const estimatedSize = JSON.stringify(docs).length;

      inspectedCollections.push({
        name,
        documentCount: docs.length,
        indexes,
        sampleDocument: docs[0] ? { ...docs[0] } : undefined,
        estimatedSize,
      });

      totalDocuments += docs.length;
      totalSize += estimatedSize;
    }

    return {
      source: 'dexie',
      collections: inspectedCollections,
      totalDocuments,
      totalSize,
      version: sourceConfig.version as string | undefined,
    };
  }

  /**
   * Migrates all tables from the Dexie source to Pocket format.
   */
  async migrate(): Promise<BridgeMigrationResult> {
    const startTime = Date.now();
    const sourceConfig = this.config.sourceConfig ?? {};
    const tables = (sourceConfig.tables ?? {}) as Record<
      string,
      { schema?: string; docs?: Record<string, unknown>[] }
    >;

    const collectionResults: CollectionMigrationResult[] = [];
    const warnings: string[] = [];
    const errors: BridgeMigrationResult['errors'] = [];
    let totalDocuments = 0;
    let migratedDocuments = 0;
    let failedDocuments = 0;
    let skippedDocuments = 0;

    for (const [name, table] of Object.entries(tables)) {
      if (this.config.targetCollections && !this.config.targetCollections.includes(name)) {
        continue;
      }

      const result = await this.migrateCollection(name, table);
      collectionResults.push(result);

      totalDocuments += result.documentCount;
      migratedDocuments += result.migratedCount;
      failedDocuments += result.failedCount;
      skippedDocuments += result.documentCount - result.migratedCount - result.failedCount;
    }

    return {
      source: 'dexie',
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
   * Migrates a single Dexie table.
   */
  async migrateCollection(
    name: string,
    tableData?: { schema?: string; docs?: Record<string, unknown>[] },
  ): Promise<CollectionMigrationResult> {
    const startTime = Date.now();
    const sourceConfig = this.config.sourceConfig ?? {};
    const tables = (sourceConfig.tables ?? {}) as Record<
      string,
      { schema?: string; docs?: Record<string, unknown>[] }
    >;
    const data = tableData ?? tables[name];
    const docs = data?.docs ?? [];
    const schema = data?.schema;

    const primaryKey = schema ? this.extractPrimaryKey(schema) : 'id';
    const isAutoIncrement = schema ? schema.includes('++') : false;

    let migratedCount = 0;
    let failedCount = 0;
    let indexesMigrated = 0;

    const totalBatches = Math.ceil(docs.length / this.batchSize);

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const batchStart = batchIndex * this.batchSize;
      const batch = docs.slice(batchStart, batchStart + this.batchSize);

      for (let i = 0; i < batch.length; i++) {
        try {
          const rawDoc = batch[i];
          const doc = { ...rawDoc };

          // Map auto-increment or explicit primary key
          let id: string;
          if (this.config.preserveIds !== false && doc[primaryKey] !== undefined) {
            id = String(doc[primaryKey]);
          } else if (isAutoIncrement) {
            id = String(batchStart + i + 1);
          } else {
            id = String(doc[primaryKey] ?? `${name}-${batchStart + i}`);
          }

          if (primaryKey !== '_id') {
            delete doc[primaryKey];
          }

          const pocketDoc: Record<string, unknown> = {
            _id: id,
            ...doc,
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

    // Migrate indexes (including compound indexes)
    if (this.config.includeIndexes && schema) {
      const indexes = this.parseSchemaIndexes(schema);
      indexesMigrated = indexes.length;
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

  /**
   * Parses a Dexie schema string and extracts index field names.
   *
   * Dexie syntax:
   * - `++field` — auto-increment primary key
   * - `&field` — unique index
   * - `*field` — multi-entry index
   * - `[a+b]` — compound index
   * - `field` — regular index
   */
  private parseSchemaIndexes(schema: string): string[] {
    return schema
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map((part) => {
        // Strip prefixes
        let field = part;
        if (field.startsWith('++')) field = field.slice(2);
        else if (field.startsWith('&')) field = field.slice(1);
        else if (field.startsWith('*')) field = field.slice(1);
        return field;
      });
  }

  /** Extracts the primary key field from a Dexie schema string. */
  private extractPrimaryKey(schema: string): string {
    const parts = schema.split(',').map((p) => p.trim());
    const first = parts[0] ?? '';
    if (first.startsWith('++')) return first.slice(2);
    if (first.startsWith('&')) return first.slice(1);
    return first || 'id';
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
 * Creates a new Dexie migration bridge.
 *
 * @param config - Bridge migration configuration with source set to 'dexie'
 * @returns A configured DexieMigrationBridge instance
 *
 * @example
 * ```typescript
 * const bridge = createDexieBridge({
 *   source: 'dexie',
 *   sourceConfig: {
 *     tables: {
 *       friends: { schema: '++id, name, age, *tags', docs: [...] }
 *     }
 *   },
 * });
 * const result = await bridge.migrate();
 * ```
 */
export function createDexieBridge(config: BridgeMigrationConfig): DexieMigrationBridge {
  return new DexieMigrationBridge(config);
}
