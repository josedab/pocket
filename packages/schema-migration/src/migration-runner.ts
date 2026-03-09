/**
 * @pocket/schema-migration — Migration runner with rollback support.
 *
 * Executes migrations in order, tracks state, and supports rollback
 * on failure. Uses a pluggable MigrationStore for persistence.
 *
 * @module @pocket/schema-migration
 */

import { Subject } from 'rxjs';
import type {
  Migration,
  MigrationDirection,
  MigrationEvent,
  MigrationPlan,
  MigrationRecord,
  MigrationResult,
  MigrationStep,
  MigrationStepResult,
  MigrationStore,
} from './types.js';

// ── In-Memory Migration Store ─────────────────────────────

export class InMemoryMigrationStore implements MigrationStore {
  private records: MigrationRecord[] = [];
  private collections = new Map<string, Record<string, unknown>[]>();

  async getAppliedMigrations(): Promise<MigrationRecord[]> {
    return [...this.records];
  }

  async getCurrentVersion(): Promise<number> {
    const applied = this.records.filter((r) => r.status === 'applied');
    return applied.length > 0 ? Math.max(...applied.map((r) => r.version)) : 0;
  }

  async recordMigration(record: MigrationRecord): Promise<void> {
    const idx = this.records.findIndex((r) => r.version === record.version);
    if (idx >= 0) {
      this.records[idx] = record;
    } else {
      this.records.push(record);
    }
  }

  async updateMigration(version: number, updates: Partial<MigrationRecord>): Promise<void> {
    const idx = this.records.findIndex((r) => r.version === version);
    if (idx >= 0) {
      this.records[idx] = { ...this.records[idx]!, ...updates };
    }
  }

  async getCollectionData(collection: string): Promise<Record<string, unknown>[]> {
    return [...(this.collections.get(collection) ?? [])];
  }

  async setCollectionData(collection: string, data: Record<string, unknown>[]): Promise<void> {
    this.collections.set(collection, data);
  }

  async createCollection(collection: string): Promise<void> {
    if (!this.collections.has(collection)) {
      this.collections.set(collection, []);
    }
  }

  async dropCollection(collection: string): Promise<void> {
    this.collections.delete(collection);
  }

  async renameCollection(from: string, to: string): Promise<void> {
    const data = this.collections.get(from) ?? [];
    this.collections.delete(from);
    this.collections.set(to, data);
  }

  async collectionExists(collection: string): Promise<boolean> {
    return this.collections.has(collection);
  }
}

// ── Migration Runner ──────────────────────────────────────

export interface MigrationRunnerConfig {
  store: MigrationStore;
  migrations: Migration[];
  dryRun?: boolean;
  rollbackOnError?: boolean;
}

/**
 * Executes schema migrations with rollback support.
 */
export class MigrationRunner {
  private readonly config: Required<MigrationRunnerConfig>;
  private readonly events$$ = new Subject<MigrationEvent>();

  readonly events$ = this.events$$.asObservable();

  constructor(config: MigrationRunnerConfig) {
    this.config = {
      store: config.store,
      migrations: [...config.migrations].sort((a, b) => a.version - b.version),
      dryRun: config.dryRun ?? false,
      rollbackOnError: config.rollbackOnError ?? true,
    };

    this.validateMigrations();
  }

  /** Plan a migration to a target version */
  async plan(targetVersion?: number): Promise<MigrationPlan> {
    const currentVersion = await this.config.store.getCurrentVersion();
    const target = targetVersion ?? Math.max(...this.config.migrations.map((m) => m.version), 0);

    const direction: MigrationDirection = target >= currentVersion ? 'up' : 'down';

    let migrations: Migration[];
    if (direction === 'up') {
      migrations = this.config.migrations.filter(
        (m) => m.version > currentVersion && m.version <= target,
      );
    } else {
      migrations = this.config.migrations
        .filter((m) => m.version <= currentVersion && m.version > target)
        .reverse();
    }

    const plan: MigrationPlan = { direction, migrations, currentVersion, targetVersion: target };
    this.events$$.next({ type: 'plan_created', plan });
    return plan;
  }

  /** Execute migrations up to the latest (or target) version */
  async migrate(targetVersion?: number): Promise<MigrationResult> {
    const plan = await this.plan(targetVersion);
    return this.executePlan(plan);
  }

  /** Rollback the last applied migration */
  async rollback(steps = 1): Promise<MigrationResult> {
    const currentVersion = await this.config.store.getCurrentVersion();
    const applied = this.config.migrations
      .filter((m) => m.version <= currentVersion)
      .sort((a, b) => b.version - a.version);

    const toRollback = applied.slice(0, steps);
    if (toRollback.length === 0) {
      return {
        success: true,
        migrationsRun: 0,
        fromVersion: currentVersion,
        toVersion: currentVersion,
        duration: 0,
        results: [],
      };
    }

    const targetVersion = toRollback.length < applied.length
      ? applied[toRollback.length]!.version
      : 0;

    const plan: MigrationPlan = {
      direction: 'down',
      migrations: toRollback,
      currentVersion,
      targetVersion,
    };

    return this.executePlan(plan);
  }

  /** Get current migration status */
  async status(): Promise<{ currentVersion: number; pending: Migration[]; applied: MigrationRecord[] }> {
    const currentVersion = await this.config.store.getCurrentVersion();
    const applied = await this.config.store.getAppliedMigrations();
    const pending = this.config.migrations.filter((m) => m.version > currentVersion);
    return { currentVersion, pending, applied };
  }

  /** Destroy the runner */
  destroy(): void {
    this.events$$.complete();
  }

  private async executePlan(plan: MigrationPlan): Promise<MigrationResult> {
    const start = performance.now();
    const results: MigrationStepResult[] = [];
    const fromVersion = plan.currentVersion;
    let currentVersion = fromVersion;

    for (const migration of plan.migrations) {
      const steps = plan.direction === 'up' ? migration.up : migration.down;
      this.events$$.next({
        type: 'migration_start',
        version: migration.version,
        name: migration.name,
        direction: plan.direction,
      });

      const stepStart = performance.now();
      let stepsExecuted = 0;

      try {
        if (!this.config.dryRun) {
          for (const step of steps) {
            await this.executeStep(step, migration.version);
            stepsExecuted++;
          }

          await this.config.store.recordMigration({
            version: migration.version,
            name: migration.name,
            status: plan.direction === 'up' ? 'applied' : 'rolled_back',
            appliedAt: plan.direction === 'up' ? Date.now() : null,
            rolledBackAt: plan.direction === 'down' ? Date.now() : null,
            executionTimeMs: performance.now() - stepStart,
          });
        }

        currentVersion = plan.direction === 'up' ? migration.version : migration.version - 1;

        const durationMs = performance.now() - stepStart;
        results.push({
          version: migration.version,
          name: migration.name,
          direction: plan.direction,
          success: true,
          durationMs,
          stepsExecuted,
        });

        this.events$$.next({
          type: 'migration_complete',
          version: migration.version,
          name: migration.name,
          durationMs,
        });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        results.push({
          version: migration.version,
          name: migration.name,
          direction: plan.direction,
          success: false,
          durationMs: performance.now() - stepStart,
          stepsExecuted,
          error,
        });

        this.events$$.next({
          type: 'migration_error',
          version: migration.version,
          name: migration.name,
          error,
        });

        await this.config.store.recordMigration({
          version: migration.version,
          name: migration.name,
          status: 'failed',
          appliedAt: null,
          rolledBackAt: null,
          executionTimeMs: performance.now() - stepStart,
          error,
        });

        return {
          success: false,
          migrationsRun: results.length,
          fromVersion,
          toVersion: currentVersion,
          duration: performance.now() - start,
          results,
          error: `Migration ${migration.version} (${migration.name}) failed: ${error}`,
        };
      }
    }

    return {
      success: true,
      migrationsRun: results.length,
      fromVersion,
      toVersion: plan.targetVersion,
      duration: performance.now() - start,
      results,
    };
  }

  private async executeStep(step: MigrationStep, version: number): Promise<void> {
    const store = this.config.store;
    this.events$$.next({
      type: 'step_execute',
      version,
      stepType: step.type,
      collection: 'collection' in step ? (step as { collection: string }).collection : undefined,
    });

    switch (step.type) {
      case 'createCollection':
        await store.createCollection(step.collection);
        break;
      case 'dropCollection':
        await store.dropCollection(step.collection);
        break;
      case 'renameCollection':
        await store.renameCollection(step.from, step.to);
        break;
      case 'addField': {
        const docs = await store.getCollectionData(step.collection);
        const updated = docs.map((doc) => ({
          ...doc,
          [step.field.name]: doc[step.field.name] ?? step.field.defaultValue ?? null,
        }));
        await store.setCollectionData(step.collection, updated);
        break;
      }
      case 'removeField': {
        const docs = await store.getCollectionData(step.collection);
        const updated = docs.map((doc) => {
          const { [step.fieldName]: _, ...rest } = doc;
          return rest;
        });
        await store.setCollectionData(step.collection, updated);
        break;
      }
      case 'renameField': {
        const docs = await store.getCollectionData(step.collection);
        const updated = docs.map((doc) => {
          const { [step.from]: value, ...rest } = doc;
          return { ...rest, [step.to]: value };
        });
        await store.setCollectionData(step.collection, updated);
        break;
      }
      case 'modifyField':
        // Field type changes are metadata-only in schema; no data transform needed
        break;
      case 'addIndex':
        // Index creation is metadata-only in this layer
        break;
      case 'removeIndex':
        // Index removal is metadata-only in this layer
        break;
      case 'transformData': {
        const docs = await store.getCollectionData(step.collection);
        const updated = docs.map((doc) => step.transform(doc));
        await store.setCollectionData(step.collection, updated);
        break;
      }
    }
  }

  private validateMigrations(): void {
    const versions = new Set<number>();
    for (const m of this.config.migrations) {
      if (versions.has(m.version)) {
        throw new Error(`Duplicate migration version: ${m.version}`);
      }
      if (m.version < 1) {
        throw new Error(`Migration version must be >= 1, got ${m.version}`);
      }
      versions.add(m.version);
    }
  }
}

// ── Migration Builder (fluent API) ────────────────────────

export class MigrationBuilder {
  private readonly upSteps: MigrationStep[] = [];
  private readonly downSteps: MigrationStep[] = [];
  private migrationName = '';
  private migrationDescription?: string;

  constructor(private readonly version: number) {
    if (version < 1) throw new Error('Migration version must be >= 1');
  }

  name(n: string): this {
    this.migrationName = n;
    return this;
  }

  description(d: string): this {
    this.migrationDescription = d;
    return this;
  }

  createCollection(collection: string, fields: FieldDefinition[]): this {
    this.upSteps.push({
      type: 'createCollection',
      collection,
      schema: { name: collection, version: this.version, fields },
    });
    this.downSteps.unshift({ type: 'dropCollection', collection });
    return this;
  }

  dropCollection(collection: string): this {
    this.upSteps.push({ type: 'dropCollection', collection });
    return this;
  }

  addField(collection: string, field: FieldDefinition): this {
    this.upSteps.push({ type: 'addField', collection, field });
    this.downSteps.unshift({ type: 'removeField', collection, fieldName: field.name });
    return this;
  }

  removeField(collection: string, fieldName: string): this {
    this.upSteps.push({ type: 'removeField', collection, fieldName });
    return this;
  }

  renameField(collection: string, from: string, to: string): this {
    this.upSteps.push({ type: 'renameField', collection, from, to });
    this.downSteps.unshift({ type: 'renameField', collection, from: to, to: from });
    return this;
  }

  addIndex(collection: string, name: string, fields: string[], unique = false): this {
    this.upSteps.push({ type: 'addIndex', collection, index: { name, fields, unique } });
    this.downSteps.unshift({ type: 'removeIndex', collection, indexName: name });
    return this;
  }

  transformData(
    collection: string,
    transform: (doc: Record<string, unknown>) => Record<string, unknown>,
    description?: string,
  ): this {
    this.upSteps.push({ type: 'transformData', collection, transform, description });
    return this;
  }

  /** Manually specify the down steps (overrides auto-generated) */
  down(...steps: MigrationStep[]): this {
    this.downSteps.length = 0;
    this.downSteps.push(...steps);
    return this;
  }

  build(): Migration {
    if (!this.migrationName) {
      throw new Error(`Migration v${this.version} requires a name`);
    }
    return {
      version: this.version,
      name: this.migrationName,
      description: this.migrationDescription,
      timestamp: Date.now(),
      up: [...this.upSteps],
      down: [...this.downSteps],
    };
  }
}

// ── Factories ─────────────────────────────────────────────

import type { FieldDefinition } from './types.js';

/** Start building a migration for a given version */
export function defineMigration(version: number): MigrationBuilder {
  return new MigrationBuilder(version);
}

/** Create a migration runner */
export function createMigrationRunner(config: MigrationRunnerConfig): MigrationRunner {
  return new MigrationRunner(config);
}
