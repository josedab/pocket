import type { Document } from '../types/document.js';
import type { DocumentStore } from '../types/storage.js';
import type {
  DocumentMigrationResult,
  Migration,
  MigrationContext,
  MigrationDirection,
  MigrationOptions,
  MigrationProgress,
  MigrationResult,
  VersionedDocument,
} from './types.js';

/**
 * Default migration options
 */
const DEFAULT_OPTIONS: Required<Omit<MigrationOptions, 'onProgress'>> = {
  strategy: 'stop-on-error',
  batchSize: 100,
  lazy: false,
};

/**
 * Runs migrations on a collection
 */
export class MigrationRunner<T extends Document = Document> {
  private readonly store: DocumentStore<T>;
  private readonly migrations: Migration[];
  private readonly databaseName: string;
  private readonly collectionName: string;
  private readonly options: Required<Omit<MigrationOptions, 'onProgress'>> & {
    onProgress?: MigrationOptions['onProgress'];
  };

  constructor(
    store: DocumentStore<T>,
    migrations: Migration[],
    databaseName: string,
    collectionName: string,
    options: MigrationOptions = {}
  ) {
    this.store = store;
    this.migrations = this.sortMigrations(migrations);
    this.databaseName = databaseName;
    this.collectionName = collectionName;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Sort migrations by version
   */
  private sortMigrations(migrations: Migration[]): Migration[] {
    return [...migrations].sort((a, b) => a.version - b.version);
  }

  /**
   * Get migrations needed to go from one version to another
   */
  getMigrationsForPath(
    fromVersion: number,
    toVersion: number
  ): { migrations: Migration[]; direction: MigrationDirection } {
    if (fromVersion === toVersion) {
      return { migrations: [], direction: 'up' };
    }

    const direction: MigrationDirection = fromVersion < toVersion ? 'up' : 'down';
    let relevantMigrations: Migration[];

    if (direction === 'up') {
      relevantMigrations = this.migrations.filter(
        (m) => m.version > fromVersion && m.version <= toVersion
      );
    } else {
      relevantMigrations = this.migrations
        .filter((m) => m.version <= fromVersion && m.version > toVersion)
        .reverse();
    }

    return { migrations: relevantMigrations, direction };
  }

  /**
   * Run migrations on all documents
   */
  async runAll(fromVersion: number, toVersion: number): Promise<MigrationResult> {
    const startTime = Date.now();
    const { migrations, direction } = this.getMigrationsForPath(fromVersion, toVersion);

    if (migrations.length === 0) {
      return this.createResult(fromVersion, toVersion, 0, 0, [], startTime);
    }

    const documents = await this.store.getAll();
    const total = documents.length;
    const failures: DocumentMigrationResult[] = [];
    let successCount = 0;

    this.reportProgress('reading', 0, total);

    for (let i = 0; i < documents.length; i += this.options.batchSize) {
      const batch = documents.slice(i, i + this.options.batchSize);
      const batchResults = await this.migrateBatch(
        batch,
        migrations,
        direction,
        fromVersion,
        toVersion
      );

      for (const result of batchResults) {
        if (result.success) {
          successCount++;
        } else {
          failures.push(result);

          if (this.options.strategy === 'stop-on-error') {
            return this.createResult(
              fromVersion,
              toVersion,
              total,
              successCount,
              failures,
              startTime
            );
          }

          if (this.options.strategy === 'rollback-on-error') {
            await this.rollbackBatch(
              batch.slice(0, batchResults.indexOf(result)),
              migrations,
              fromVersion,
              toVersion
            );
            return this.createResult(fromVersion, toVersion, total, 0, failures, startTime);
          }
        }
      }

      this.reportProgress('migrating', Math.min(i + this.options.batchSize, total), total);
    }

    this.reportProgress('complete', total, total);

    return this.createResult(fromVersion, toVersion, total, successCount, failures, startTime);
  }

  /**
   * Migrate a single document (for lazy migration)
   */
  async migrateDocument(
    doc: VersionedDocument<T>,
    targetVersion: number
  ): Promise<{ document: VersionedDocument<T>; migrated: boolean }> {
    const docVersion = doc._schemaVersion ?? 1;

    if (docVersion === targetVersion) {
      return { document: doc, migrated: false };
    }

    const { migrations, direction } = this.getMigrationsForPath(docVersion, targetVersion);

    if (migrations.length === 0) {
      return { document: doc, migrated: false };
    }

    const context: MigrationContext = {
      databaseName: this.databaseName,
      collectionName: this.collectionName,
      fromVersion: docVersion,
      toVersion: targetVersion,
      direction,
    };

    let migratedDoc: unknown = doc;

    for (const migration of migrations) {
      const migrator = direction === 'up' ? migration.up : migration.down;

      if (!migrator) {
        throw new Error(
          `Migration to version ${migration.version} does not support ${direction} direction`
        );
      }

      migratedDoc = await migrator(migratedDoc, context);
    }

    const result = migratedDoc as VersionedDocument<T>;
    result._schemaVersion = targetVersion;

    return { document: result, migrated: true };
  }

  /**
   * Migrate a batch of documents
   */
  private async migrateBatch(
    documents: T[],
    _migrations: Migration[],
    _direction: MigrationDirection,
    fromVersion: number,
    toVersion: number
  ): Promise<DocumentMigrationResult[]> {
    const results: DocumentMigrationResult[] = [];
    const updatedDocs: T[] = [];

    for (const doc of documents) {
      const versionedDoc = doc as VersionedDocument<T>;
      const docVersion = versionedDoc._schemaVersion ?? fromVersion;

      try {
        const { document: migratedDoc, migrated } = await this.migrateDocument(
          versionedDoc,
          toVersion
        );

        if (migrated) {
          updatedDocs.push(migratedDoc as T);
        }

        results.push({
          documentId: doc._id,
          success: true,
          fromVersion: docVersion,
          toVersion,
        });
      } catch (error) {
        results.push({
          documentId: doc._id,
          success: false,
          error: error instanceof Error ? error : new Error(String(error)),
          fromVersion: docVersion,
          toVersion,
        });
      }
    }

    if (updatedDocs.length > 0) {
      this.reportProgress('writing', 0, updatedDocs.length);
      await this.store.bulkPut(updatedDocs);
    }

    return results;
  }

  /**
   * Rollback a batch of documents
   */
  private async rollbackBatch(
    documents: T[],
    migrationsToRollback: Migration[],
    fromVersion: number,
    toVersion: number
  ): Promise<void> {
    const rollbackMigrations = [...migrationsToRollback].reverse();
    const rollbackDirection: MigrationDirection = fromVersion < toVersion ? 'down' : 'up';

    await this.migrateBatch(
      documents,
      rollbackMigrations,
      rollbackDirection,
      toVersion,
      fromVersion
    );
  }

  /**
   * Report progress
   */
  private reportProgress(phase: MigrationProgress['phase'], current: number, total: number): void {
    if (this.options.onProgress) {
      this.options.onProgress({
        collectionName: this.collectionName,
        current,
        total,
        percentage: total > 0 ? Math.round((current / total) * 100) : 100,
        phase,
      });
    }
  }

  /**
   * Create migration result
   */
  private createResult(
    fromVersion: number,
    toVersion: number,
    totalDocuments: number,
    successCount: number,
    failures: DocumentMigrationResult[],
    startTime: number
  ): MigrationResult {
    return {
      collectionName: this.collectionName,
      fromVersion,
      toVersion,
      totalDocuments,
      successCount,
      failureCount: failures.length,
      failures,
      durationMs: Date.now() - startTime,
    };
  }
}
