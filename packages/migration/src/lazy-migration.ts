/**
 * Lazy Migration Engine — transforms documents on-read using a migration
 * chain, with background batch processing for zero-downtime migrations.
 */

import { BehaviorSubject, Subject } from 'rxjs';

/** A single migration step. */
export interface LazyMigrationStep {
  readonly version: number;
  readonly name: string;
  /** Transform a document from the previous version to this version. */
  readonly up: (doc: Record<string, unknown>) => Record<string, unknown>;
  /** Reverse transform (for rollback). */
  readonly down?: (doc: Record<string, unknown>) => Record<string, unknown>;
}

/** Migration chain: ordered sequence of steps. */
export interface LazyMigrationChain {
  readonly steps: readonly LazyMigrationStep[];
  readonly currentVersion: number;
}

/** Progress of a background migration. */
export interface LazyMigrationProgress {
  readonly collection: string;
  readonly totalDocuments: number;
  readonly migratedDocuments: number;
  readonly percentComplete: number;
  readonly status: 'idle' | 'running' | 'completed' | 'rolled-back' | 'error';
  readonly startedAt?: number;
  readonly completedAt?: number;
  readonly error?: string;
}

/** Configuration for the lazy migration engine. */
export interface LazyMigrationConfig {
  /** Batch size for background processing. Defaults to 100. */
  readonly batchSize?: number;
  /** Delay between batches in ms. Defaults to 50. */
  readonly batchDelayMs?: number;
  /** Whether to run background migration automatically. Defaults to false. */
  readonly autoMigrate?: boolean;
}

/** Document store interface for the migration engine. */
export interface LazyMigrationDocumentStore {
  getAll(collection: string): Promise<Record<string, unknown>[]>;
  put(collection: string, doc: Record<string, unknown>): Promise<void>;
  getVersion(collection: string, docId: string): number | undefined;
  setVersion(collection: string, docId: string, version: number): void;
}

export class LazyMigrationEngine {
  private readonly chains = new Map<string, LazyMigrationChain>();
  private readonly documentVersions = new Map<string, Map<string, number>>();
  private readonly progress = new Map<string, LazyMigrationProgress>();
  private readonly progress$ = new BehaviorSubject<readonly LazyMigrationProgress[]>([]);
  private readonly events$ = new Subject<{
    type: 'migrated' | 'batch-complete' | 'complete' | 'rollback' | 'error';
    collection: string;
    details?: string;
  }>();
  private readonly config: Required<LazyMigrationConfig>;
  private batchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config?: LazyMigrationConfig) {
    this.config = {
      batchSize: config?.batchSize ?? 100,
      batchDelayMs: config?.batchDelayMs ?? 50,
      autoMigrate: config?.autoMigrate ?? false,
    };
  }

  /** Register a migration chain for a collection. */
  registerChain(collection: string, chain: LazyMigrationChain): void {
    this.chains.set(collection, chain);
    this.documentVersions.set(collection, new Map());
    this.progress.set(collection, {
      collection,
      totalDocuments: 0,
      migratedDocuments: 0,
      percentComplete: 0,
      status: 'idle',
    });
    this.emitProgress();
  }

  /**
   * Transform a document lazily: applies all pending migration steps
   * between the document's current version and the chain's target version.
   */
  transformOnRead(collection: string, doc: Record<string, unknown>): Record<string, unknown> {
    const chain = this.chains.get(collection);
    if (!chain) return doc;

    const docId = (doc._id as string) ?? '';
    const versions = this.documentVersions.get(collection);
    const docVersion = versions?.get(docId) ?? 0;

    if (docVersion >= chain.currentVersion) return doc;

    // Apply migration steps in order
    let result = { ...doc };
    for (const step of chain.steps) {
      if (step.version > docVersion) {
        result = step.up(result);
      }
    }

    // Track that this document is now at the current version
    versions?.set(docId, chain.currentVersion);

    result._schemaVersion = chain.currentVersion;
    return result;
  }

  /**
   * Run background batch migration for a collection.
   * Processes documents in batches with configurable delays to avoid
   * blocking the main thread.
   */
  async runBackgroundMigration(
    collection: string,
    store: LazyMigrationDocumentStore
  ): Promise<LazyMigrationProgress> {
    const chain = this.chains.get(collection);
    if (!chain) {
      return {
        collection,
        totalDocuments: 0,
        migratedDocuments: 0,
        percentComplete: 0,
        status: 'error',
        error: 'No migration chain registered',
      };
    }

    const allDocs = await store.getAll(collection);
    const totalDocuments = allDocs.length;
    let migratedDocuments = 0;

    this.updateProgress(collection, {
      totalDocuments,
      migratedDocuments: 0,
      percentComplete: 0,
      status: 'running',
      startedAt: Date.now(),
    });

    // Process in batches
    for (let i = 0; i < allDocs.length; i += this.config.batchSize) {
      const batch = allDocs.slice(i, i + this.config.batchSize);

      for (const doc of batch) {
        const docVersion = store.getVersion(collection, doc._id as string) ?? 0;
        if (docVersion >= chain.currentVersion) {
          migratedDocuments++;
          continue;
        }

        const migrated = this.transformOnRead(collection, doc);
        await store.put(collection, migrated);
        store.setVersion(collection, doc._id as string, chain.currentVersion);
        migratedDocuments++;
      }

      this.updateProgress(collection, {
        migratedDocuments,
        percentComplete: totalDocuments > 0 ? (migratedDocuments / totalDocuments) * 100 : 100,
        status: 'running',
      });
      this.events$.next({
        type: 'batch-complete',
        collection,
        details: `${migratedDocuments}/${totalDocuments}`,
      });

      // Yield to event loop between batches
      if (i + this.config.batchSize < allDocs.length) {
        await new Promise((r) => {
          this.batchTimer = setTimeout(r, this.config.batchDelayMs);
        });
      }
    }

    const finalProgress: LazyMigrationProgress = {
      collection,
      totalDocuments,
      migratedDocuments,
      percentComplete: 100,
      status: 'completed',
      startedAt: this.progress.get(collection)?.startedAt,
      completedAt: Date.now(),
    };
    this.progress.set(collection, finalProgress);
    this.emitProgress();
    this.events$.next({ type: 'complete', collection });

    return finalProgress;
  }

  /** Rollback a collection to a previous version. */
  rollback(
    collection: string,
    targetVersion: number,
    doc: Record<string, unknown>
  ): Record<string, unknown> {
    const chain = this.chains.get(collection);
    if (!chain) return doc;

    const docVersion = (doc._schemaVersion as number) ?? chain.currentVersion;
    if (docVersion <= targetVersion) return doc;

    let result = { ...doc };
    const stepsToRollback = [...chain.steps]
      .filter((s) => s.version > targetVersion && s.version <= docVersion)
      .reverse();

    for (const step of stepsToRollback) {
      if (step.down) {
        result = step.down(result);
      }
    }

    result._schemaVersion = targetVersion;
    this.events$.next({
      type: 'rollback',
      collection,
      details: `v${docVersion} → v${targetVersion}`,
    });
    return result;
  }

  /** Get migration progress for a collection. */
  getProgress(collection: string): LazyMigrationProgress | undefined {
    return this.progress.get(collection);
  }

  /** Observable of all migration progress. */
  get progressUpdates() {
    return this.progress$.asObservable();
  }

  /** Observable of migration events. */
  get events() {
    return this.events$.asObservable();
  }

  destroy(): void {
    if (this.batchTimer) clearTimeout(this.batchTimer);
    this.progress$.complete();
    this.events$.complete();
  }

  private updateProgress(collection: string, updates: Partial<LazyMigrationProgress>): void {
    const current = this.progress.get(collection);
    if (current) {
      this.progress.set(collection, { ...current, ...updates });
      this.emitProgress();
    }
  }

  private emitProgress(): void {
    this.progress$.next(Array.from(this.progress.values()));
  }
}

export function createLazyMigrationEngine(config?: LazyMigrationConfig): LazyMigrationEngine {
  return new LazyMigrationEngine(config);
}
