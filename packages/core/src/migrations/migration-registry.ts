import type { Migration, MigrationRegistryEntry, MigrationState } from './types.js';

/**
 * Registry for managing collection migrations
 */
export class MigrationRegistry {
  private readonly entries = new Map<string, MigrationRegistryEntry>();
  private readonly states = new Map<string, MigrationState>();

  /**
   * Register migrations for a collection
   */
  register(collectionName: string, migrations: Migration[], targetVersion?: number): void {
    const sortedMigrations = [...migrations].sort((a, b) => a.version - b.version);
    const lastMigration = sortedMigrations[sortedMigrations.length - 1];
    const maxVersion = lastMigration ? lastMigration.version : 1;

    this.entries.set(collectionName, {
      collectionName,
      migrations: sortedMigrations,
      currentVersion: targetVersion ?? maxVersion,
    });
  }

  /**
   * Add a single migration to a collection
   */
  addMigration(collectionName: string, migration: Migration): void {
    const entry = this.entries.get(collectionName);

    if (entry) {
      const existing = entry.migrations.find((m) => m.version === migration.version);
      if (existing) {
        throw new Error(
          `Migration for version ${migration.version} already exists in collection "${collectionName}"`
        );
      }

      entry.migrations.push(migration);
      entry.migrations.sort((a, b) => a.version - b.version);
      entry.currentVersion = Math.max(entry.currentVersion, migration.version);
    } else {
      this.register(collectionName, [migration]);
    }
  }

  /**
   * Get migrations for a collection
   */
  getMigrations(collectionName: string): Migration[] {
    return this.entries.get(collectionName)?.migrations ?? [];
  }

  /**
   * Get current target version for a collection
   */
  getCurrentVersion(collectionName: string): number {
    return this.entries.get(collectionName)?.currentVersion ?? 1;
  }

  /**
   * Check if a collection has migrations registered
   */
  hasMigrations(collectionName: string): boolean {
    const entry = this.entries.get(collectionName);
    return entry !== undefined && entry.migrations.length > 0;
  }

  /**
   * Get all registered collections
   */
  getRegisteredCollections(): string[] {
    return [...this.entries.keys()];
  }

  /**
   * Get registry entry
   */
  getEntry(collectionName: string): MigrationRegistryEntry | undefined {
    return this.entries.get(collectionName);
  }

  /**
   * Set migration state for a collection
   */
  setState(collectionName: string, state: MigrationState): void {
    this.states.set(collectionName, state);
  }

  /**
   * Get migration state for a collection
   */
  getState(collectionName: string): MigrationState | undefined {
    return this.states.get(collectionName);
  }

  /**
   * Clear all registrations
   */
  clear(): void {
    this.entries.clear();
    this.states.clear();
  }

  /**
   * Validate migrations for a collection
   */
  validateMigrations(collectionName: string): MigrationValidationResult {
    const entry = this.entries.get(collectionName);
    const errors: string[] = [];

    if (!entry) {
      return { valid: true, errors: [] };
    }

    const { migrations } = entry;

    // Check for version gaps
    for (let i = 1; i < migrations.length; i++) {
      const prev = migrations[i - 1]!;
      const curr = migrations[i]!;
      if (curr.version !== prev.version + 1) {
        errors.push(`Version gap detected: migration ${prev.version} to ${curr.version}`);
      }
    }

    // Check for missing down migrations (warning, not error)
    const warnings: string[] = [];
    for (const migration of migrations) {
      if (!migration.down) {
        warnings.push(`Migration to version ${migration.version} has no down migration`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    } satisfies MigrationValidationResult;
  }
}

/**
 * Migration validation result
 */
export interface MigrationValidationResult {
  valid: boolean;
  errors: string[];
  warnings?: string[];
}

/**
 * Global migration registry singleton
 */
let globalRegistry: MigrationRegistry | null = null;

/**
 * Get the global migration registry
 */
export function getMigrationRegistry(): MigrationRegistry {
  globalRegistry ??= new MigrationRegistry();
  return globalRegistry;
}

/**
 * Reset the global migration registry (for testing)
 */
export function resetMigrationRegistry(): void {
  globalRegistry = null;
}
