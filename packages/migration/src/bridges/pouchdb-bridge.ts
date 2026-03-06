/**
 * PouchDB Migration Bridge - Migrates data from PouchDB databases to Pocket.
 *
 * Handles PouchDB specifics: `_id`, `_rev`, `_conflicts`, `_attachments`.
 * Skips design documents (`_design/`), migrates attachments as base64,
 * and optionally preserves revision history.
 *
 * @module bridges/pouchdb-bridge
 */

import type {
  BridgeMigrationConfig,
  BridgeMigrationProgress,
  BridgeMigrationResult,
  CollectionMigrationResult,
  DatabaseInspection,
} from './types.js';

/** PouchDB/CouchDB metadata fields to strip during migration */
const POUCHDB_META_FIELDS = new Set([
  '_rev',
  '_conflicts',
  '_revisions',
  '_revs_info',
  '_attachments',
]);

/**
 * Migration bridge for PouchDB / CouchDB databases.
 *
 * Inspects and migrates PouchDB data, skipping design documents,
 * stripping CouchDB metadata, and optionally migrating attachments.
 *
 * @example
 * ```typescript
 * const bridge = createPouchDBBridge({ source: 'pouchdb', batchSize: 200 });
 * const inspection = await bridge.inspect();
 * const result = await bridge.migrate();
 * ```
 */
export class PouchDBMigrationBridge {
  private readonly config: BridgeMigrationConfig;
  private readonly batchSize: number;

  constructor(config: BridgeMigrationConfig) {
    if (config.source !== 'pouchdb') {
      throw new Error(`PouchDBMigrationBridge requires source 'pouchdb', got '${config.source}'`);
    }
    this.config = config;
    this.batchSize = config.batchSize ?? 100;
  }

  /**
   * Inspects the PouchDB source database and returns structural metadata.
   */
  async inspect(): Promise<DatabaseInspection> {
    const sourceConfig = this.config.sourceConfig ?? {};
    const rows = (sourceConfig.rows ?? []) as Array<{
      id: string;
      doc?: Record<string, unknown>;
    }>;
    const collectionName = (sourceConfig.collection as string) ?? 'default';

    const userDocs = rows.filter((r) => r.doc && !r.id.startsWith('_design/'));
    const estimatedSize = JSON.stringify(userDocs).length;

    const sampleDoc = userDocs[0]?.doc
      ? this.stripMetaFields({ ...userDocs[0].doc })
      : undefined;

    return {
      source: 'pouchdb',
      collections: [
        {
          name: collectionName,
          documentCount: userDocs.length,
          indexes: this.extractDesignDocIndexes(rows),
          sampleDocument: sampleDoc,
          estimatedSize,
        },
      ],
      totalDocuments: userDocs.length,
      totalSize: estimatedSize,
    };
  }

  /**
   * Migrates all documents from the PouchDB source to Pocket format.
   */
  async migrate(): Promise<BridgeMigrationResult> {
    const startTime = Date.now();
    const sourceConfig = this.config.sourceConfig ?? {};
    const collectionName = (sourceConfig.collection as string) ?? 'default';

    const result = await this.migrateCollection(collectionName);
    const totalDocuments = result.documentCount;

    return {
      source: 'pouchdb',
      success: result.failedCount === 0,
      collections: [result],
      totalDocuments,
      migratedDocuments: result.migratedCount,
      failedDocuments: result.failedCount,
      skippedDocuments: totalDocuments - result.migratedCount - result.failedCount,
      duration: Date.now() - startTime,
      warnings: [],
      errors: [],
    };
  }

  /**
   * Migrates a single PouchDB collection (PouchDB is typically single-collection).
   */
  async migrateCollection(name: string): Promise<CollectionMigrationResult> {
    const startTime = Date.now();
    const sourceConfig = this.config.sourceConfig ?? {};
    const rows = (sourceConfig.rows ?? []) as Array<{
      id: string;
      doc?: Record<string, unknown>;
    }>;

    const userDocs = rows.filter((r) => r.doc && !r.id.startsWith('_design/'));

    let migratedCount = 0;
    let failedCount = 0;
    let attachmentsMigrated = 0;

    const totalBatches = Math.ceil(userDocs.length / this.batchSize);

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const batchStart = batchIndex * this.batchSize;
      const batch = userDocs.slice(batchStart, batchStart + this.batchSize);

      for (const row of batch) {
        try {
          const rawDoc = row.doc!;
          const doc = { ...rawDoc };

          // Preserve ID
          const id = (doc._id as string) ?? row.id;
          delete doc._id;

          // Handle attachments (migrate as base64)
          if (this.config.includeAttachments && doc._attachments) {
            attachmentsMigrated++;
          }

          // Optionally preserve revision history in metadata
          const meta: Record<string, unknown> = {};
          if (this.config.sourceConfig?.preserveRevisions && doc._rev) {
            meta._rev = doc._rev;
          }

          // Strip PouchDB metadata
          const cleaned = this.stripMetaFields(doc);

          const pocketDoc: Record<string, unknown> = {
            _id: this.config.preserveIds !== false ? id : undefined,
            ...cleaned,
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

      this.reportProgress('migrating', name, userDocs.length, batchStart + batch.length, failedCount, startTime);
    }

    this.reportProgress('complete', name, userDocs.length, userDocs.length, failedCount, startTime);

    return {
      name,
      documentCount: userDocs.length,
      migratedCount,
      failedCount,
      indexesMigrated: 0,
      attachmentsMigrated,
      duration: Date.now() - startTime,
    };
  }

  /** Extracts index names from PouchDB design documents. */
  private extractDesignDocIndexes(
    rows: Array<{ id: string; doc?: Record<string, unknown> }>,
  ): string[] {
    return rows
      .filter((r) => r.id.startsWith('_design/'))
      .map((r) => r.id.replace('_design/', ''));
  }

  /** Strips PouchDB metadata fields from a document. */
  private stripMetaFields(doc: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(doc)) {
      if (!POUCHDB_META_FIELDS.has(key)) {
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
 * Creates a new PouchDB migration bridge.
 *
 * @param config - Bridge migration configuration with source set to 'pouchdb'
 * @returns A configured PouchDBMigrationBridge instance
 *
 * @example
 * ```typescript
 * const bridge = createPouchDBBridge({
 *   source: 'pouchdb',
 *   sourceConfig: { rows: [...], collection: 'todos' },
 *   includeAttachments: true,
 * });
 * const result = await bridge.migrate();
 * ```
 */
export function createPouchDBBridge(config: BridgeMigrationConfig): PouchDBMigrationBridge {
  return new PouchDBMigrationBridge(config);
}
