import type { Document } from '../types/document.js';
import type { StorageAdapter } from '../types/storage.js';
import {
  getMigrationRegistry,
  type MigrationRegistry,
  type MigrationValidationResult,
} from './migration-registry.js';
import { MigrationRunner } from './migration-runner.js';
import type {
  Migration,
  MigrationOptions,
  MigrationResult,
  MigrationState,
  VersionedDocument,
} from './types.js';

/**
 * Internal collection name for storing migration state
 */
const MIGRATION_STATE_COLLECTION = '_pocket_migrations';

/**
 * Manages schema migrations for a database
 */
export class MigrationManager {
  private readonly databaseName: string;
  private readonly storage: StorageAdapter;
  private readonly registry: MigrationRegistry;
  private readonly options: MigrationOptions;
  private initialized = false;

  constructor(
    databaseName: string,
    storage: StorageAdapter,
    options: MigrationOptions = {},
    registry?: MigrationRegistry
  ) {
    this.databaseName = databaseName;
    this.storage = storage;
    this.options = options;
    this.registry = registry ?? getMigrationRegistry();
  }

  /**
   * Initialize the migration manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Load migration states from storage
    const store = this.storage.getStore<MigrationStateDoc>(MIGRATION_STATE_COLLECTION);
    const states = await store.getAll();

    for (const state of states) {
      this.registry.setState(state.collectionName, {
        collectionName: state.collectionName,
        currentVersion: state.currentVersion,
        lastMigrationAt: state.lastMigrationAt,
        pendingLazyMigrations: state.pendingLazyMigrations,
      });
    }

    this.initialized = true;
  }

  /**
   * Register migrations for a collection
   */
  registerMigrations(collectionName: string, migrations: Migration[]): void {
    this.registry.register(collectionName, migrations);
  }

  /**
   * Add a single migration
   */
  addMigration(collectionName: string, migration: Migration): void {
    this.registry.addMigration(collectionName, migration);
  }

  /**
   * Get the current stored version for a collection
   */
  getStoredVersion(collectionName: string): number {
    const state = this.registry.getState(collectionName);
    return state?.currentVersion ?? 1;
  }

  /**
   * Get the target version for a collection
   */
  getTargetVersion(collectionName: string): number {
    return this.registry.getCurrentVersion(collectionName);
  }

  /**
   * Check if a collection needs migration
   */
  needsMigration(collectionName: string): boolean {
    const stored = this.getStoredVersion(collectionName);
    const target = this.getTargetVersion(collectionName);
    return stored !== target;
  }

  /**
   * Run migrations for a collection
   */
  async migrate(collectionName: string, options?: MigrationOptions): Promise<MigrationResult> {
    const targetVersion = this.getTargetVersion(collectionName);
    return this.migrateToVersion(collectionName, targetVersion, options ?? this.options);
  }

  /**
   * Run migrations to a specific version
   */
  async migrateToVersion(
    collectionName: string,
    targetVersion: number,
    options?: MigrationOptions
  ): Promise<MigrationResult> {
    const migrations = this.registry.getMigrations(collectionName);
    const storedVersion = this.getStoredVersion(collectionName);
    const store = this.storage.getStore(collectionName);

    const runner = new MigrationRunner(
      store,
      migrations,
      this.databaseName,
      collectionName,
      options ?? this.options
    );

    const result = await runner.runAll(storedVersion, targetVersion);

    // Update migration state if successful
    if (
      result.failureCount === 0 ||
      (options?.strategy ?? this.options.strategy) === 'continue-on-error'
    ) {
      await this.updateState(collectionName, targetVersion);
    }

    return result;
  }

  /**
   * Run migrations for all registered collections
   */
  async migrateAll(options?: MigrationOptions): Promise<Map<string, MigrationResult>> {
    const results = new Map<string, MigrationResult>();
    const collections = this.registry.getRegisteredCollections();

    for (const collectionName of collections) {
      if (this.needsMigration(collectionName)) {
        const result = await this.migrate(collectionName, options);
        results.set(collectionName, result);
      }
    }

    return results;
  }

  /**
   * Rollback to a previous version
   */
  async rollback(
    collectionName: string,
    targetVersion: number,
    options?: MigrationOptions
  ): Promise<MigrationResult> {
    const currentVersion = this.getStoredVersion(collectionName);

    if (targetVersion >= currentVersion) {
      throw new Error(
        `Cannot rollback to version ${targetVersion}: current version is ${currentVersion}`
      );
    }

    return this.migrateToVersion(collectionName, targetVersion, options);
  }

  /**
   * Migrate a single document lazily
   */
  async migrateDocumentLazy<T extends Document>(
    collectionName: string,
    doc: VersionedDocument<T>
  ): Promise<VersionedDocument<T>> {
    const migrations = this.registry.getMigrations(collectionName);
    const targetVersion = this.getTargetVersion(collectionName);
    const store = this.storage.getStore<T>(collectionName);

    const runner = new MigrationRunner(store, migrations, this.databaseName, collectionName, {
      lazy: true,
    });

    const { document: migratedDoc, migrated } = await runner.migrateDocument(doc, targetVersion);

    if (migrated) {
      // Save the migrated document
      await store.put(migratedDoc as T);

      // Update pending count
      const state = this.registry.getState(collectionName);
      if (state && state.pendingLazyMigrations > 0) {
        await this.updateState(
          collectionName,
          state.currentVersion,
          state.pendingLazyMigrations - 1
        );
      }
    }

    return migratedDoc;
  }

  /**
   * Get migration status for all collections
   */
  getMigrationStatus(): MigrationStatus[] {
    const collections = this.registry.getRegisteredCollections();
    const status: MigrationStatus[] = [];

    for (const collectionName of collections) {
      const stored = this.getStoredVersion(collectionName);
      const target = this.getTargetVersion(collectionName);
      const state = this.registry.getState(collectionName);

      status.push({
        collectionName,
        storedVersion: stored,
        targetVersion: target,
        needsMigration: stored !== target,
        lastMigrationAt: state?.lastMigrationAt ?? null,
        pendingLazyMigrations: state?.pendingLazyMigrations ?? 0,
      });
    }

    return status;
  }

  /**
   * Validate all registered migrations
   */
  validateMigrations(): Map<string, MigrationValidationResult> {
    const results = new Map<string, MigrationValidationResult>();
    const collections = this.registry.getRegisteredCollections();

    for (const collectionName of collections) {
      results.set(collectionName, this.registry.validateMigrations(collectionName));
    }

    return results;
  }

  /**
   * Update migration state in storage
   */
  private async updateState(
    collectionName: string,
    version: number,
    pendingLazy = 0
  ): Promise<void> {
    const state: MigrationState = {
      collectionName,
      currentVersion: version,
      lastMigrationAt: Date.now(),
      pendingLazyMigrations: pendingLazy,
    };

    this.registry.setState(collectionName, state);

    const store = this.storage.getStore<MigrationStateDoc>(MIGRATION_STATE_COLLECTION);
    await store.put({
      _id: collectionName,
      ...state,
    });
  }
}

/**
 * Migration state document
 */
interface MigrationStateDoc extends Document, MigrationState {}

/**
 * Migration status for a collection
 */
export interface MigrationStatus {
  collectionName: string;
  storedVersion: number;
  targetVersion: number;
  needsMigration: boolean;
  lastMigrationAt: number | null;
  pendingLazyMigrations: number;
}

/**
 * Create a migration manager
 */
export function createMigrationManager(
  databaseName: string,
  storage: StorageAdapter,
  options?: MigrationOptions,
  registry?: MigrationRegistry
): MigrationManager {
  return new MigrationManager(databaseName, storage, options, registry);
}
