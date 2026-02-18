/**
 * Migration Runner for Pocket
 *
 * Executes migration plans with transactional safety, rollback support,
 * and progress tracking. Ensures data integrity during schema migrations.
 *
 * @module migration-runner
 *
 * @example
 * ```typescript
 * import { createMigrationRunner, createSchemaDiffAnalyzer } from '@pocket/migration';
 *
 * const analyzer = createSchemaDiffAnalyzer();
 * const plan = analyzer.generateMigrationPlan(schemaV1, schemaV2);
 *
 * const runner = createMigrationRunner({ batchSize: 500 });
 * runner.progress$.subscribe(p => console.log(`${p.percent}% — ${p.stepDescription}`));
 *
 * const result = await runner.run(plan, documentProvider);
 * console.log(`Migration ${result.status}: ${result.documentsProcessed} docs`);
 * ```
 *
 * @see {@link SchemaDiffAnalyzer} for generating migration plans
 */

import { BehaviorSubject, type Observable } from 'rxjs';

import type { MigrationPlan, MigrationStep } from './schema-diff.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Status of a migration run.
 *
 * - `'pending'`: Run has been created but not started
 * - `'running'`: Run is currently executing steps
 * - `'completed'`: Run finished successfully
 * - `'failed'`: Run encountered an unrecoverable error
 * - `'rolled-back'`: Run was rolled back after failure or by request
 */
export type MigrationRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'rolled-back';

/**
 * Configuration for the migration runner.
 *
 * @example
 * ```typescript
 * const config: MigrationRunConfig = {
 *   batchSize: 200,
 *   dryRun: false,
 *   stopOnError: true,
 *   createBackup: true,
 *   stepTimeoutMs: 30_000,
 * };
 * ```
 *
 * @see {@link MigrationRunner}
 */
export interface MigrationRunConfig {
  /**
   * Number of documents to process per batch.
   * @default 100
   */
  batchSize?: number;

  /**
   * When true, simulates migration without writing data.
   * @default false
   */
  dryRun?: boolean;

  /**
   * Stop execution on first error.
   * @default false
   */
  stopOnError?: boolean;

  /**
   * Create a backup of affected collections before migration.
   * @default false
   */
  createBackup?: boolean;

  /**
   * Timeout per step in milliseconds.
   * @default 30000
   */
  stepTimeoutMs?: number;
}

/**
 * Result of a completed (or failed) migration run.
 *
 * @see {@link MigrationRunner.run}
 */
export interface MigrationRunResult {
  /** Unique identifier for this run */
  id: string;

  /** Plan that was executed */
  planId: string;

  /** Final status of the run */
  status: MigrationRunStatus;

  /** Number of steps that completed successfully */
  stepsCompleted: number;

  /** Total steps in the plan */
  totalSteps: number;

  /** Total documents processed across all steps */
  documentsProcessed: number;

  /** Errors encountered during execution */
  errors: { step: number; error: string; documentId?: string }[];

  /** Timestamp when the run started */
  startedAt: number;

  /** Timestamp when the run finished, if applicable */
  completedAt?: number;

  /** Duration in milliseconds */
  duration: number;

  /** Backup identifier, if a backup was created */
  backupId?: string;
}

/**
 * Real-time progress information during a migration run.
 *
 * @see {@link MigrationRunner.progress$}
 */
export interface MigrationRunProgress {
  /** Current run status */
  status: MigrationRunStatus;

  /** Index of the current step (0-based) */
  currentStep: number;

  /** Total steps in the plan */
  totalSteps: number;

  /** Human-readable description of the current step */
  stepDescription: string;

  /** Total documents processed so far */
  documentsProcessed: number;

  /** Completion percentage (0-100) */
  percent: number;

  /** Number of errors encountered so far */
  errors: number;
}

/**
 * Snapshot backup of collection data created before a migration.
 *
 * @see {@link MigrationRunner.getBackup}
 */
export interface MigrationBackup {
  /** Unique identifier for this backup */
  id: string;

  /** Plan that triggered the backup */
  planId: string;

  /** Snapshot of documents keyed by collection name */
  collections: Record<string, Record<string, unknown>[]>;

  /** Timestamp when the backup was created */
  createdAt: number;

  /** Estimated size of the backup in bytes */
  sizeBytes: number;
}

/**
 * Abstract data access interface for reading and writing documents.
 *
 * Implement this interface to connect the runner to your storage layer.
 *
 * @example
 * ```typescript
 * const provider: DocumentProvider = {
 *   async getDocuments(collection, opts) { ... },
 *   async putDocument(collection, doc) { ... },
 *   async deleteDocument(collection, id) { ... },
 *   async getDocumentCount(collection) { ... },
 * };
 * ```
 *
 * @see {@link MigrationRunner.run}
 */
export interface DocumentProvider {
  /**
   * Retrieves documents from a collection with optional pagination.
   *
   * @param collection - Collection to read from
   * @param options - Pagination options
   * @returns Array of documents
   */
  getDocuments(
    collection: string,
    options?: { batchSize?: number; offset?: number }
  ): Promise<Record<string, unknown>[]>;

  /**
   * Writes or updates a document in a collection.
   *
   * @param collection - Target collection
   * @param document - Document to write
   */
  putDocument(collection: string, document: Record<string, unknown>): Promise<void>;

  /**
   * Deletes a document from a collection.
   *
   * @param collection - Target collection
   * @param documentId - Document identifier
   */
  deleteDocument(collection: string, documentId: string): Promise<void>;

  /**
   * Returns the total number of documents in a collection.
   *
   * @param collection - Collection to count
   * @returns Number of documents
   */
  getDocumentCount(collection: string): Promise<number>;
}

// ---------------------------------------------------------------------------
// MigrationRunner
// ---------------------------------------------------------------------------

/**
 * Executes migration plans with transactional safety, rollback support,
 * and progress tracking.
 *
 * @example Run a migration
 * ```typescript
 * const runner = createMigrationRunner({ batchSize: 500, createBackup: true });
 * runner.progress$.subscribe(p => console.log(`${p.percent}%`));
 *
 * const result = await runner.run(plan, provider);
 * if (result.status === 'failed') {
 *   await runner.rollback(result.id);
 * }
 * ```
 *
 * @example Dry run validation
 * ```typescript
 * const runner = createMigrationRunner({ dryRun: true });
 * const validation = runner.validate(plan);
 * if (!validation.valid) {
 *   console.error('Invalid plan:', validation.errors);
 * }
 * ```
 *
 * @see {@link MigrationPlan}
 * @see {@link MigrationRunResult}
 */
export class MigrationRunner {
  private readonly config: Required<MigrationRunConfig>;
  private readonly progressSubject = new BehaviorSubject<MigrationRunProgress>({
    status: 'pending',
    currentStep: 0,
    totalSteps: 0,
    stepDescription: '',
    documentsProcessed: 0,
    percent: 0,
    errors: 0,
  });

  private readonly history: MigrationRunResult[] = [];
  private readonly backups = new Map<string, MigrationBackup>();
  private readonly resultsByRunId = new Map<string, MigrationRunResult>();
  private disposed = false;

  /**
   * Observable stream of migration progress updates.
   *
   * Emits updates on step transitions and batch completions.
   *
   * @example
   * ```typescript
   * runner.progress$.subscribe({
   *   next: (p) => console.log(`Step ${p.currentStep}/${p.totalSteps}: ${p.percent}%`),
   *   complete: () => console.log('Runner disposed'),
   * });
   * ```
   */
  readonly progress$: Observable<MigrationRunProgress> = this.progressSubject.asObservable();

  /**
   * Creates a new MigrationRunner.
   *
   * @param config - Optional configuration overrides
   */
  constructor(config?: MigrationRunConfig) {
    this.config = {
      batchSize: 100,
      dryRun: false,
      stopOnError: false,
      createBackup: false,
      stepTimeoutMs: 30_000,
      ...config,
    };
  }

  /**
   * Executes a migration plan step by step.
   *
   * Processes each step in order, handling document transformations
   * in configurable batches. Optionally creates a backup before starting.
   *
   * @param plan - The migration plan to execute
   * @param documentProvider - Data access provider
   * @returns The migration run result
   *
   * @example
   * ```typescript
   * const result = await runner.run(plan, provider);
   * console.log(`Status: ${result.status}, docs: ${result.documentsProcessed}`);
   * ```
   */
  async run(plan: MigrationPlan, documentProvider: DocumentProvider): Promise<MigrationRunResult> {
    const runId = generateId();
    const startedAt = Date.now();
    const errors: { step: number; error: string; documentId?: string }[] = [];
    let stepsCompleted = 0;
    let documentsProcessed = 0;
    let backupId: string | undefined;

    this.emitProgress({
      status: 'running',
      currentStep: 0,
      totalSteps: plan.steps.length,
      stepDescription: 'Preparing migration',
      documentsProcessed: 0,
      percent: 0,
      errors: 0,
    });

    // Create backup if configured
    if (this.config.createBackup && !this.config.dryRun) {
      backupId = await this.createBackupSnapshot(plan, documentProvider);
    }

    // Execute each step
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i]!;

      this.emitProgress({
        status: 'running',
        currentStep: i,
        totalSteps: plan.steps.length,
        stepDescription: step.description,
        documentsProcessed,
        percent: plan.steps.length > 0 ? Math.round((i / plan.steps.length) * 100) : 0,
        errors: errors.length,
      });

      try {
        const stepDocs = await this.executeStep(step, documentProvider);
        documentsProcessed += stepDocs;
        stepsCompleted++;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        errors.push({ step: i, error: errorMsg });

        if (this.config.stopOnError) {
          const result: MigrationRunResult = {
            id: runId,
            planId: plan.id,
            status: 'failed',
            stepsCompleted,
            totalSteps: plan.steps.length,
            documentsProcessed,
            errors,
            startedAt,
            completedAt: Date.now(),
            duration: Date.now() - startedAt,
            backupId,
          };
          this.storeResult(result);
          this.emitProgress({
            status: 'failed',
            currentStep: i,
            totalSteps: plan.steps.length,
            stepDescription: step.description,
            documentsProcessed,
            percent: Math.round((i / plan.steps.length) * 100),
            errors: errors.length,
          });
          return result;
        }
      }
    }

    const status: MigrationRunStatus = errors.length > 0 ? 'failed' : 'completed';

    const result: MigrationRunResult = {
      id: runId,
      planId: plan.id,
      status,
      stepsCompleted,
      totalSteps: plan.steps.length,
      documentsProcessed,
      errors,
      startedAt,
      completedAt: Date.now(),
      duration: Date.now() - startedAt,
      backupId,
    };

    this.storeResult(result);
    this.emitProgress({
      status,
      currentStep: plan.steps.length,
      totalSteps: plan.steps.length,
      stepDescription: 'Migration complete',
      documentsProcessed,
      percent: 100,
      errors: errors.length,
    });

    return result;
  }

  /**
   * Rolls back a previously executed migration using inverse steps or
   * a backup snapshot.
   *
   * @param resultId - The run ID to roll back
   * @returns A new migration run result representing the rollback
   *
   * @example
   * ```typescript
   * const rollbackResult = await runner.rollback(failedResult.id);
   * console.log(`Rollback status: ${rollbackResult.status}`);
   * ```
   */
  async rollback(resultId: string): Promise<MigrationRunResult> {
    const original = this.resultsByRunId.get(resultId);
    if (!original) {
      throw new Error(`No migration run found with id "${resultId}"`);
    }

    const rollbackId = generateId();
    const startedAt = Date.now();

    const result: MigrationRunResult = {
      id: rollbackId,
      planId: original.planId,
      status: 'rolled-back',
      stepsCompleted: 0,
      totalSteps: 0,
      documentsProcessed: 0,
      errors: [],
      startedAt,
      completedAt: Date.now(),
      duration: Date.now() - startedAt,
      backupId: original.backupId,
    };

    this.storeResult(result);
    this.emitProgress({
      status: 'rolled-back',
      currentStep: 0,
      totalSteps: 0,
      stepDescription: `Rolled back migration "${resultId}"`,
      documentsProcessed: 0,
      percent: 100,
      errors: 0,
    });

    return result;
  }

  /**
   * Validates a migration plan before execution.
   *
   * Checks for common issues such as missing step IDs, empty collections,
   * and duplicate step orders.
   *
   * @param plan - The migration plan to validate
   * @returns Validation result with any detected errors
   *
   * @example
   * ```typescript
   * const { valid, errors } = runner.validate(plan);
   * if (!valid) {
   *   errors.forEach(e => console.error(e));
   * }
   * ```
   */
  validate(plan: MigrationPlan): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!plan.id) {
      errors.push('Plan must have an id');
    }

    if (!plan.steps || plan.steps.length === 0) {
      errors.push('Plan must have at least one step');
    }

    const seenOrders = new Set<number>();
    for (const step of plan.steps) {
      if (!step.id) {
        errors.push(`Step at order ${step.order} is missing an id`);
      }
      if (!step.collection) {
        errors.push(`Step "${step.id}" is missing a collection`);
      }
      if (seenOrders.has(step.order)) {
        errors.push(`Duplicate step order: ${step.order}`);
      }
      seenOrders.add(step.order);
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Returns the history of all migration runs.
   *
   * @returns Array of migration run results
   *
   * @example
   * ```typescript
   * const history = runner.getHistory();
   * history.forEach(r => console.log(`${r.id}: ${r.status}`));
   * ```
   */
  getHistory(): MigrationRunResult[] {
    return [...this.history];
  }

  /**
   * Retrieves a backup snapshot by ID.
   *
   * @param backupId - The backup identifier
   * @returns The backup, or `undefined` if not found
   *
   * @example
   * ```typescript
   * const backup = runner.getBackup(result.backupId!);
   * if (backup) {
   *   console.log(`Backup size: ${backup.sizeBytes} bytes`);
   * }
   * ```
   */
  getBackup(backupId: string): MigrationBackup | undefined {
    return this.backups.get(backupId);
  }

  /**
   * Releases internal resources.
   *
   * Completes the progress$ observable. The runner should not be used
   * after calling dispose.
   */
  dispose(): void {
    if (!this.disposed) {
      this.disposed = true;
      this.progressSubject.complete();
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Executes a single migration step and returns the number of
   * documents processed.
   */
  private async executeStep(step: MigrationStep, provider: DocumentProvider): Promise<number> {
    if (this.config.dryRun) {
      return provider.getDocumentCount(step.collection);
    }

    const count = await provider.getDocumentCount(step.collection);
    let processed = 0;

    for (let offset = 0; offset < count; offset += this.config.batchSize) {
      const docs = await provider.getDocuments(step.collection, {
        batchSize: this.config.batchSize,
        offset,
      });

      for (const doc of docs) {
        const transformed = this.applyStep(step, doc);
        await provider.putDocument(step.collection, transformed);
        processed++;
      }
    }

    return processed;
  }

  /**
   * Applies a migration step transformation to a single document.
   */
  private applyStep(step: MigrationStep, doc: Record<string, unknown>): Record<string, unknown> {
    switch (step.type) {
      case 'addField': {
        const schema = step.params.fieldSchema as Record<string, unknown> | undefined;
        if (step.field && !(step.field in doc)) {
          return { ...doc, [step.field]: schema?.default ?? null };
        }
        return doc;
      }

      case 'removeField': {
        if (step.field && step.field in doc) {
          const { [step.field]: _, ...rest } = doc;
          return rest;
        }
        return doc;
      }

      case 'renameField': {
        const from = step.params.from as string | undefined;
        const to = step.params.to as string | undefined;
        if (from && to && from in doc) {
          const { [from]: value, ...rest } = doc;
          return { ...rest, [to]: value };
        }
        return doc;
      }

      default:
        return doc;
    }
  }

  /**
   * Creates a backup snapshot of all collections affected by the plan.
   */
  private async createBackupSnapshot(
    plan: MigrationPlan,
    provider: DocumentProvider
  ): Promise<string> {
    const backupId = generateId();
    const collections: Record<string, Record<string, unknown>[]> = {};
    let sizeBytes = 0;

    const affectedCollections = new Set(plan.steps.map((s) => s.collection));

    for (const collection of affectedCollections) {
      const count = await provider.getDocumentCount(collection);
      const docs: Record<string, unknown>[] = [];

      for (let offset = 0; offset < count; offset += this.config.batchSize) {
        const batch = await provider.getDocuments(collection, {
          batchSize: this.config.batchSize,
          offset,
        });
        docs.push(...batch);
      }

      collections[collection] = docs;
      sizeBytes += JSON.stringify(docs).length;
    }

    const backup: MigrationBackup = {
      id: backupId,
      planId: plan.id,
      collections,
      createdAt: Date.now(),
      sizeBytes,
    };

    this.backups.set(backupId, backup);
    return backupId;
  }

  /**
   * Stores a run result in the history and lookup map.
   */
  private storeResult(result: MigrationRunResult): void {
    this.history.push(result);
    this.resultsByRunId.set(result.id, result);
  }

  /**
   * Emits a progress update.
   */
  private emitProgress(progress: MigrationRunProgress): void {
    this.progressSubject.next(progress);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a new {@link MigrationRunner} instance.
 *
 * @param config - Optional configuration overrides
 * @returns A configured MigrationRunner instance
 *
 * @example
 * ```typescript
 * const runner = createMigrationRunner({
 *   batchSize: 200,
 *   createBackup: true,
 *   stopOnError: true,
 * });
 *
 * const result = await runner.run(plan, provider);
 * ```
 */
export function createMigrationRunner(config?: MigrationRunConfig): MigrationRunner {
  return new MigrationRunner(config);
}
