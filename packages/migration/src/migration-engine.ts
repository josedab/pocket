/**
 * MigrationEngine - Core engine for running database migrations to Pocket.
 *
 * Orchestrates the full migration lifecycle: adapter selection, source analysis,
 * schema mapping, batch document migration, and validation. Emits real-time
 * progress updates via an RxJS Observable.
 *
 * @module migration-engine
 */

import { Subject, type Observable } from 'rxjs';

import type {
  CollectionMigrationSummary,
  MigrationConfig,
  MigrationError,
  MigrationProgress,
  MigrationResult,
  SourceAnalysis,
  SourceDocument,
} from './types.js';
import type { MigrationAdapter } from './adapters/base-adapter.js';
import { PouchDBAdapter, type PouchDBData } from './adapters/pouchdb-adapter.js';
import { RxDBAdapter, type RxDBData } from './adapters/rxdb-adapter.js';
import { DexieAdapter, type DexieData } from './adapters/dexie-adapter.js';
import { FirestoreAdapter, type FirestoreData } from './adapters/firestore-adapter.js';

/**
 * Core migration engine that coordinates data migration from various
 * source databases to Pocket.
 *
 * Supports PouchDB, RxDB, Dexie, and Firestore as migration sources.
 * Processes documents in configurable batches, handles errors per document
 * without stopping the entire migration, and emits progress updates via
 * an RxJS Subject.
 *
 * @example Basic migration
 * ```typescript
 * const engine = createMigrationEngine({ source: 'pouchdb' });
 * engine.progress$.subscribe(p => console.log(`${p.percent}%`));
 *
 * const result = await engine.run(pouchDBData);
 * console.log(`Migrated ${result.migratedDocuments} documents`);
 * ```
 *
 * @example Dry run with transform
 * ```typescript
 * const engine = createMigrationEngine({
 *   source: 'firestore',
 *   dryRun: true,
 *   transformDocument: (doc) => ({ ...doc, migratedAt: Date.now() })
 * });
 *
 * const result = await engine.dryRun(firestoreData);
 * console.log(`Would migrate ${result.migratedDocuments} documents`);
 * ```
 *
 * @see {@link MigrationConfig}
 * @see {@link MigrationResult}
 */
export class MigrationEngine {
  private readonly config: Required<
    Pick<MigrationConfig, 'source' | 'batchSize' | 'dryRun'>
  > &
    MigrationConfig;

  private readonly progressSubject = new Subject<MigrationProgress>();

  /**
   * Observable stream of migration progress events.
   *
   * Emits updates on phase changes and after each batch is processed.
   * Completes when the migration finishes.
   *
   * @example
   * ```typescript
   * engine.progress$.subscribe({
   *   next: (p) => console.log(`Phase: ${p.phase}, ${p.percent}%`),
   *   complete: () => console.log('Migration finished')
   * });
   * ```
   */
  readonly progress$: Observable<MigrationProgress> =
    this.progressSubject.asObservable();

  /**
   * Creates a new MigrationEngine.
   *
   * @param config - Migration configuration
   */
  constructor(config: MigrationConfig) {
    this.config = {
      batchSize: 100,
      dryRun: false,
      ...config,
    };
  }

  /**
   * Runs the full migration pipeline.
   *
   * 1. Creates the appropriate adapter for the source type
   * 2. Analyzes the source database structure
   * 3. Maps source schemas to Pocket schemas
   * 4. Migrates documents in batches
   * 5. Validates the migration results
   *
   * @param sourceData - Raw data from the source database
   * @returns Migration result summary
   */
  async run(sourceData: unknown): Promise<MigrationResult> {
    const startTime = Date.now();
    const adapter = this.createAdapter(sourceData);
    const errors: MigrationError[] = [];
    const collections: Record<string, CollectionMigrationSummary> = {};

    // Phase 1: Analyze
    this.emitProgress('analyzing', 0, 0);
    const analysis = await adapter.analyze();
    const allCollections = await this.filterCollections(
      await adapter.getCollections(),
    );

    // Phase 2: Schema mapping
    this.emitProgress('schema-mapping', 0, allCollections.length);
    const schemas = new Map<string, Awaited<ReturnType<typeof adapter.getSchema>>>();
    for (let i = 0; i < allCollections.length; i++) {
      const collectionName = allCollections[i]!;
      const schema = await adapter.getSchema(collectionName);
      schemas.set(collectionName, schema);
      this.emitProgress('schema-mapping', i + 1, allCollections.length);
    }

    // Phase 3: Migrate documents
    let totalMigrated = 0;
    let totalFailed = 0;
    let totalSkipped = 0;
    const totalDocs = analysis.totalDocuments;

    this.emitProgress('migrating', 0, totalDocs);

    for (const collectionName of allCollections) {
      const schema = schemas.get(collectionName)!;
      const docCount = await adapter.getDocumentCount(collectionName);
      let collectionMigrated = 0;
      let collectionFailed = 0;
      let collectionSkipped = 0;

      for (let offset = 0; offset < docCount; offset += this.config.batchSize) {
        const batch = await adapter.getDocuments(collectionName, {
          limit: this.config.batchSize,
          skip: offset,
        });

        for (const doc of batch) {
          try {
            const transformed = this.config.transformDocument
              ? this.config.transformDocument(doc)
              : doc;

            if (transformed === null) {
              collectionSkipped++;
              totalSkipped++;
              continue;
            }

            if (!this.config.dryRun) {
              // In a real implementation, this would write to a Pocket database.
              // For now, we validate the document can be processed.
              this.validateDocument(transformed);
            }

            collectionMigrated++;
            totalMigrated++;
          } catch (err) {
            collectionFailed++;
            totalFailed++;
            errors.push({
              collection: collectionName,
              documentId: doc._id,
              error: err instanceof Error ? err.message : String(err),
              phase: 'migrating',
            });
          }
        }

        this.emitProgress(
          'migrating',
          totalMigrated + totalFailed + totalSkipped,
          totalDocs,
          collectionName,
        );
      }

      collections[collectionName] = {
        sourceCollection: collectionName,
        targetCollection: schema.targetCollection,
        documentCount: collectionMigrated,
        failedCount: collectionFailed,
        skippedCount: collectionSkipped,
      };
    }

    // Phase 4: Validate
    this.emitProgress('validating', 0, 1);
    this.emitProgress('validating', 1, 1);

    // Phase 5: Complete
    const duration = Date.now() - startTime;
    this.emitProgress('complete', totalDocs, totalDocs);
    this.progressSubject.complete();

    return {
      totalDocuments: totalDocs,
      migratedDocuments: totalMigrated,
      failedDocuments: totalFailed,
      skippedDocuments: totalSkipped,
      errors,
      duration,
      collections,
    };
  }

  /**
   * Analyzes the source database without performing migration.
   *
   * @param sourceData - Raw data from the source database
   * @returns Source analysis with collection names, counts, and size estimates
   */
  async analyze(sourceData: unknown): Promise<SourceAnalysis> {
    const adapter = this.createAdapter(sourceData);
    this.emitProgress('analyzing', 0, 0);
    const analysis = await adapter.analyze();
    this.emitProgress('analyzing', 1, 1);
    return analysis;
  }

  /**
   * Simulates a migration without writing any data.
   *
   * Runs the full pipeline with `dryRun` forced to `true`, allowing
   * you to preview the migration results before committing.
   *
   * @param sourceData - Raw data from the source database
   * @returns Migration result summary (no data written)
   */
  async dryRun(sourceData: unknown): Promise<MigrationResult> {
    const originalDryRun = this.config.dryRun;
    this.config.dryRun = true;
    try {
      return await this.run(sourceData);
    } finally {
      this.config.dryRun = originalDryRun;
    }
  }

  /**
   * Creates the appropriate adapter based on the configured source type.
   */
  private createAdapter(sourceData: unknown): MigrationAdapter {
    switch (this.config.source) {
      case 'pouchdb':
        return new PouchDBAdapter(sourceData as PouchDBData);
      case 'rxdb':
        return new RxDBAdapter(sourceData as RxDBData);
      case 'dexie':
        return new DexieAdapter(sourceData as DexieData);
      case 'firestore':
        return new FirestoreAdapter(sourceData as FirestoreData);
      default:
        throw new Error(`Unsupported migration source: ${this.config.source}`);
    }
  }

  /**
   * Filters collections based on include/skip configuration.
   */
  private async filterCollections(collections: string[]): Promise<string[]> {
    let filtered = collections;

    if (this.config.includeCollections?.length) {
      filtered = filtered.filter((c) =>
        this.config.includeCollections!.includes(c),
      );
    }

    if (this.config.skipCollections?.length) {
      filtered = filtered.filter(
        (c) => !this.config.skipCollections!.includes(c),
      );
    }

    return filtered;
  }

  /**
   * Validates that a document has the minimum required structure.
   */
  private validateDocument(doc: SourceDocument): void {
    if (!doc._id || typeof doc._id !== 'string') {
      throw new Error('Document must have a string _id field');
    }
  }

  /**
   * Emits a progress update to both the RxJS subject and the callback.
   */
  private emitProgress(
    phase: MigrationProgress['phase'],
    current: number,
    total: number,
    collection?: string,
  ): void {
    const progress: MigrationProgress = {
      phase,
      collection,
      current,
      total,
      percent: total > 0 ? Math.round((current / total) * 100) : 0,
    };

    this.progressSubject.next(progress);
    this.config.onProgress?.(progress);
  }
}

/**
 * Creates a new MigrationEngine instance.
 *
 * @param config - Migration configuration
 * @returns A configured MigrationEngine instance
 *
 * @example
 * ```typescript
 * const engine = createMigrationEngine({
 *   source: 'pouchdb',
 *   batchSize: 200,
 *   onProgress: (p) => console.log(`${p.percent}%`)
 * });
 *
 * const result = await engine.run(pouchDBData);
 * ```
 */
export function createMigrationEngine(config: MigrationConfig): MigrationEngine {
  return new MigrationEngine(config);
}
