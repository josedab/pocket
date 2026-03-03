import type { SchemaDefinition } from '../schema/schema.js';
import type { SchemaDiffResult } from './schema-evolution.js';
import { diffSchemas } from './schema-evolution.js';

/**
 * Compatibility level between two schema versions.
 */
export type CompatibilityLevel = 'backward' | 'forward' | 'full' | 'breaking' | 'none';

/**
 * A registered schema version entry.
 */
export interface SchemaVersionEntry {
  collection: string;
  version: number;
  schema: SchemaDefinition;
  contentHash: string;
  createdAt: number;
  parentVersion: number | null;
  compatibility: CompatibilityLevel;
}

/**
 * Result of checking compatibility between two schema versions.
 */
export interface CompatibilityResult {
  compatible: boolean;
  level: CompatibilityLevel;
  issues: CompatibilityIssue[];
  canAutoMigrate: boolean;
}

/**
 * A single compatibility issue found during checking.
 */
export interface CompatibilityIssue {
  severity: 'error' | 'warning' | 'info';
  field: string;
  message: string;
  autoFixable: boolean;
}

function computeContentHash(schema: SchemaDefinition): string {
  const str = JSON.stringify(schema);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Registry for tracking schema versions per collection.
 *
 * @example
 * ```typescript
 * const registry = createSchemaVersionRegistry();
 * registry.register('users', userSchemaV1);
 * registry.register('users', userSchemaV2);
 * const compat = registry.checkCompatibility('users', 1, 2);
 * ```
 */
export class SchemaVersionRegistry {
  private readonly versions = new Map<string, SchemaVersionEntry[]>();

  constructor() {}

  /**
   * Register a new schema version for a collection.
   */
  register(collection: string, schema: SchemaDefinition, version?: number): SchemaVersionEntry {
    const history = this.versions.get(collection) ?? [];
    const nextVersion = version ?? (history.length > 0 ? history[history.length - 1]!.version + 1 : 1);

    const existing = history.find((e) => e.version === nextVersion);
    if (existing) {
      throw new Error(`Version ${nextVersion} already registered for collection "${collection}"`);
    }

    const parentVersion = history.length > 0 ? history[history.length - 1]!.version : null;
    const compatibility = parentVersion !== null
      ? this.computeCompatibilityLevel(collection, parentVersion, schema)
      : 'none' as CompatibilityLevel;

    const entry: SchemaVersionEntry = {
      collection,
      version: nextVersion,
      schema,
      contentHash: computeContentHash(schema),
      createdAt: Date.now(),
      parentVersion,
      compatibility,
    };

    history.push(entry);
    history.sort((a, b) => a.version - b.version);
    this.versions.set(collection, history);

    return entry;
  }

  /**
   * Get a specific version entry for a collection.
   */
  getVersion(collection: string, version: number): SchemaVersionEntry | null {
    const history = this.versions.get(collection);
    return history?.find((e) => e.version === version) ?? null;
  }

  /**
   * Get the latest version entry for a collection.
   */
  getLatest(collection: string): SchemaVersionEntry | null {
    const history = this.versions.get(collection);
    if (!history || history.length === 0) return null;
    return history[history.length - 1]!;
  }

  /**
   * Get the full version history for a collection.
   */
  getHistory(collection: string): SchemaVersionEntry[] {
    return [...(this.versions.get(collection) ?? [])];
  }

  /**
   * Diff two registered schema versions for a collection.
   */
  diff(collection: string, fromVersion: number, toVersion: number): SchemaDiffResult {
    const fromEntry = this.getVersion(collection, fromVersion);
    const toEntry = this.getVersion(collection, toVersion);

    if (!fromEntry) {
      throw new Error(`Version ${fromVersion} not found for collection "${collection}"`);
    }
    if (!toEntry) {
      throw new Error(`Version ${toVersion} not found for collection "${collection}"`);
    }

    return diffSchemas(
      { ...fromEntry.schema, version: fromVersion },
      { ...toEntry.schema, version: toVersion },
    );
  }

  /**
   * Check compatibility between two schema versions.
   */
  checkCompatibility(
    collection: string,
    fromVersion: number,
    toVersion: number,
  ): CompatibilityResult {
    const diffResult = this.diff(collection, fromVersion, toVersion);
    const issues: CompatibilityIssue[] = [];

    let hasBreaking = false;
    let backwardSafe = true;
    let forwardSafe = true;

    for (const change of diffResult.changes) {
      switch (change.type) {
        case 'field_added': {
          if (change.current?.required && change.current.default === undefined) {
            hasBreaking = true;
            forwardSafe = false;
            issues.push({
              severity: 'error',
              field: change.path,
              message: `Required field "${change.path}" added without default`,
              autoFixable: false,
            });
          } else {
            issues.push({
              severity: 'info',
              field: change.path,
              message: `Optional field "${change.path}" added`,
              autoFixable: true,
            });
          }
          break;
        }

        case 'field_removed': {
          forwardSafe = false;
          if (change.previous?.required) {
            issues.push({
              severity: 'warning',
              field: change.path,
              message: `Required field "${change.path}" removed`,
              autoFixable: true,
            });
          } else {
            issues.push({
              severity: 'info',
              field: change.path,
              message: `Optional field "${change.path}" removed`,
              autoFixable: true,
            });
          }
          break;
        }

        case 'field_type_changed': {
          if (!change.safe) {
            hasBreaking = true;
            backwardSafe = false;
            forwardSafe = false;
            issues.push({
              severity: 'error',
              field: change.path,
              message: `Type change on "${change.path}" is not lossless`,
              autoFixable: false,
            });
          } else {
            issues.push({
              severity: 'warning',
              field: change.path,
              message: `Type change on "${change.path}" is lossless`,
              autoFixable: true,
            });
          }
          break;
        }

        case 'field_required_changed': {
          if (change.current?.required && change.current.default === undefined) {
            hasBreaking = true;
            backwardSafe = false;
            issues.push({
              severity: 'error',
              field: change.path,
              message: `Field "${change.path}" became required without default`,
              autoFixable: false,
            });
          } else {
            issues.push({
              severity: 'info',
              field: change.path,
              message: `Field "${change.path}" required status changed`,
              autoFixable: true,
            });
          }
          break;
        }

        default: {
          issues.push({
            severity: 'info',
            field: change.path,
            message: change.description,
            autoFixable: true,
          });
        }
      }
    }

    let level: CompatibilityLevel;
    if (diffResult.identical) {
      level = 'full';
    } else if (hasBreaking) {
      level = 'breaking';
    } else if (backwardSafe && forwardSafe) {
      level = 'full';
    } else if (backwardSafe) {
      level = 'backward';
    } else if (forwardSafe) {
      level = 'forward';
    } else {
      level = 'breaking';
    }

    const canAutoMigrate = diffResult.autoMigrateSafe && !hasBreaking;

    return {
      compatible: level !== 'breaking',
      level,
      issues,
      canAutoMigrate,
    };
  }

  /**
   * Rollback to a previous version by marking it as the latest.
   */
  rollback(collection: string, toVersion: number): SchemaVersionEntry {
    const history = this.versions.get(collection);
    if (!history || history.length === 0) {
      throw new Error(`No versions found for collection "${collection}"`);
    }

    const targetEntry = history.find((e) => e.version === toVersion);
    if (!targetEntry) {
      throw new Error(`Version ${toVersion} not found for collection "${collection}"`);
    }

    const rolled = history.filter((e) => e.version <= toVersion);
    this.versions.set(collection, rolled);

    return targetEntry;
  }

  /**
   * Get all registered collections and their version histories.
   */
  getAll(): Map<string, SchemaVersionEntry[]> {
    const result = new Map<string, SchemaVersionEntry[]>();
    for (const [key, entries] of this.versions) {
      result.set(key, [...entries]);
    }
    return result;
  }

  /**
   * Clean up the registry.
   */
  destroy(): void {
    this.versions.clear();
  }

  private computeCompatibilityLevel(
    collection: string,
    parentVersion: number,
    newSchema: SchemaDefinition,
  ): CompatibilityLevel {
    const parentEntry = this.getVersion(collection, parentVersion);
    if (!parentEntry) return 'none';

    const diffResult = diffSchemas(parentEntry.schema, newSchema);
    if (diffResult.identical) return 'full';

    let backwardSafe = true;
    let forwardSafe = true;

    for (const change of diffResult.changes) {
      if (change.type === 'field_added' && change.current?.required && change.current.default === undefined) {
        backwardSafe = false;
        forwardSafe = false;
      }
      if (change.type === 'field_removed') {
        forwardSafe = false;
      }
      if (change.type === 'field_type_changed' && !change.safe) {
        backwardSafe = false;
        forwardSafe = false;
      }
      if (change.type === 'field_required_changed' && change.current?.required && change.current.default === undefined) {
        backwardSafe = false;
      }
    }

    if (backwardSafe && forwardSafe) return 'full';
    if (backwardSafe) return 'backward';
    if (forwardSafe) return 'forward';
    return 'breaking';
  }
}

/**
 * Create a new schema version registry.
 *
 * @example
 * ```typescript
 * const registry = createSchemaVersionRegistry();
 * registry.register('users', userSchemaV1);
 * ```
 */
export function createSchemaVersionRegistry(): SchemaVersionRegistry {
  return new SchemaVersionRegistry();
}
