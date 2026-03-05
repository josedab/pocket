import type { SchemaVersionRegistry } from './schema-registry.js';
import type { SchemaChange } from './schema-evolution.js';

/**
 * Result of an auto-migration operation.
 */
export interface AutoMigrationResult {
  success: boolean;
  migratedCount: number;
  failedCount: number;
  duration: number;
  errors: Array<{ documentId: string; error: string }>;
  rollbackAvailable: boolean;
}

/**
 * A plan describing the steps required for a migration.
 */
export interface MigrationPlan {
  steps: MigrationStep[];
  estimatedDuration: number;
  canAutoApply: boolean;
  breakingChanges: string[];
  warnings: string[];
}

/**
 * A single step in a migration plan.
 */
export interface MigrationStep {
  type: 'add_field' | 'remove_field' | 'rename_field' | 'change_type' | 'add_default' | 'custom_transform';
  field: string;
  description: string;
  safe: boolean;
  details: Record<string, unknown>;
}

/**
 * Result of simulating a migration on sample documents.
 */
export interface SimulationResult {
  success: boolean;
  sampleSize: number;
  successRate: number;
  failedDocuments: Array<{ document: Record<string, unknown>; error: string }>;
  transformedSample: Record<string, unknown>[];
}

type TransformFn = (doc: Record<string, unknown>) => Record<string, unknown>;

function makeTransformKey(collection: string, from: number, to: number): string {
  return `${collection}:${from}:${to}`;
}

const SAFE_COERCIONS: Record<string, (v: unknown) => unknown> = {
  'number→string': (v) => String(v),
  'boolean→string': (v) => String(v),
  'string→number': (v) => {
    const n = Number(v);
    return Number.isNaN(n) ? 0 : n;
  },
  'boolean→number': (v) => (v ? 1 : 0),
  'string→boolean': (v) => v === 'true' || v === '1',
  'number→boolean': (v) => Boolean(v),
};

/**
 * Engine for automatically migrating documents between schema versions.
 *
 * @example
 * ```typescript
 * const engine = createAutoMigrationEngine(registry);
 * const result = await engine.migrate('users', docs, 1, 2);
 * ```
 */
export class AutoMigrationEngine {
  private readonly registry: SchemaVersionRegistry;
  private readonly customTransforms = new Map<string, TransformFn>();

  constructor(registry: SchemaVersionRegistry) {
    this.registry = registry;
  }

  /**
   * Migrate documents from one schema version to another.
   */
  async migrate(
    collection: string,
    documents: Record<string, unknown>[],
    fromVersion: number,
    toVersion: number,
  ): Promise<AutoMigrationResult> {
    const start = Date.now();
    const plan = this.getMigrationPlan(collection, fromVersion, toVersion);
    const errors: Array<{ documentId: string; error: string }> = [];
    let migratedCount = 0;

    for (let i = 0; i < documents.length; i++) {
      try {
        const doc = documents[i]!;
        const transformed = this.applyPlan(doc, plan, collection, fromVersion, toVersion);
        documents[i] = transformed;
        migratedCount++;
      } catch (err) {
        const docId = String((documents[i] as Record<string, unknown>)?.id ?? `index:${i}`);
        errors.push({ documentId: docId, error: (err as Error).message });
      }
    }

    return {
      success: errors.length === 0,
      migratedCount,
      failedCount: errors.length,
      duration: Date.now() - start,
      errors,
      rollbackAvailable: this.registry.getVersion(collection, fromVersion) !== null,
    };
  }

  /**
   * Check if automatic migration is possible between two versions.
   */
  canAutoMigrate(collection: string, fromVersion: number, toVersion: number): boolean {
    const customKey = makeTransformKey(collection, fromVersion, toVersion);
    if (this.customTransforms.has(customKey)) return true;

    try {
      const compat = this.registry.checkCompatibility(collection, fromVersion, toVersion);
      return compat.canAutoMigrate;
    } catch {
      return false;
    }
  }

  /**
   * Get a detailed migration plan between two versions.
   */
  getMigrationPlan(collection: string, fromVersion: number, toVersion: number): MigrationPlan {
    const diffResult = this.registry.diff(collection, fromVersion, toVersion);
    const steps: MigrationStep[] = [];
    const breakingChanges: string[] = [];
    const warnings: string[] = [];

    const customKey = makeTransformKey(collection, fromVersion, toVersion);
    const hasCustom = this.customTransforms.has(customKey);

    for (const change of diffResult.changes) {
      const step = this.changeToStep(change);
      steps.push(step);

      if (!change.safe) {
        breakingChanges.push(change.description);
      }

      if (change.type === 'field_removed') {
        warnings.push(`Field "${change.path}" will be removed`);
      }
    }

    if (hasCustom) {
      steps.push({
        type: 'custom_transform',
        field: '*',
        description: `Custom transform registered for ${collection} v${fromVersion} → v${toVersion}`,
        safe: true,
        details: {},
      });
    }

    const canAutoApply = hasCustom || diffResult.autoMigrateSafe;

    return {
      steps,
      estimatedDuration: steps.length * 10,
      canAutoApply,
      breakingChanges,
      warnings,
    };
  }

  /**
   * Simulate a migration on sample documents without modifying originals.
   */
  async simulate(
    collection: string,
    sampleDocs: Record<string, unknown>[],
    fromVersion: number,
    toVersion: number,
  ): Promise<SimulationResult> {
    const plan = this.getMigrationPlan(collection, fromVersion, toVersion);
    const failedDocuments: Array<{ document: Record<string, unknown>; error: string }> = [];
    const transformedSample: Record<string, unknown>[] = [];

    for (const doc of sampleDocs) {
      try {
        const clone = structuredClone(doc);
        const transformed = this.applyPlan(clone, plan, collection, fromVersion, toVersion);
        transformedSample.push(transformed);
      } catch (err) {
        failedDocuments.push({ document: doc, error: (err as Error).message });
      }
    }

    const successCount = sampleDocs.length - failedDocuments.length;

    return {
      success: failedDocuments.length === 0,
      sampleSize: sampleDocs.length,
      successRate: sampleDocs.length > 0 ? successCount / sampleDocs.length : 1,
      failedDocuments,
      transformedSample,
    };
  }

  /**
   * Register a custom transform function for a specific version transition.
   */
  registerTransform(
    collection: string,
    fromVersion: number,
    toVersion: number,
    transform: (doc: Record<string, unknown>) => Record<string, unknown>,
  ): void {
    const key = makeTransformKey(collection, fromVersion, toVersion);
    this.customTransforms.set(key, transform);
  }

  /**
   * Clean up the migration engine.
   */
  destroy(): void {
    this.customTransforms.clear();
  }

  private applyPlan(
    doc: Record<string, unknown>,
    plan: MigrationPlan,
    collection: string,
    fromVersion: number,
    toVersion: number,
  ): Record<string, unknown> {
    const customKey = makeTransformKey(collection, fromVersion, toVersion);
    const customTransform = this.customTransforms.get(customKey);

    if (customTransform) {
      return customTransform(doc);
    }

    let result = { ...doc };

    for (const step of plan.steps) {
      if (step.type === 'custom_transform') continue;
      result = this.applyStep(result, step);
    }

    return result;
  }

  private applyStep(doc: Record<string, unknown>, step: MigrationStep): Record<string, unknown> {
    const result = { ...doc };
    const parts = step.field.split('.');

    switch (step.type) {
      case 'add_field': {
        if (getNestedValue(result, parts) === undefined) {
          const defaultValue = step.details.default ?? null;
          setNestedValue(result, parts, defaultValue);
        }
        break;
      }

      case 'remove_field': {
        deleteNestedValue(result, parts);
        break;
      }

      case 'rename_field': {
        const newName = step.details.newName as string | undefined;
        if (newName) {
          const value = getNestedValue(result, parts);
          if (value !== undefined) {
            deleteNestedValue(result, parts);
            setNestedValue(result, newName.split('.'), value);
          }
        }
        break;
      }

      case 'change_type': {
        const value = getNestedValue(result, parts);
        if (value !== undefined && value !== null) {
          const fromType = step.details.fromType as string | undefined;
          const toType = step.details.toType as string | undefined;
          if (fromType && toType) {
            const coercionKey = `${fromType}→${toType}`;
            const coercion = SAFE_COERCIONS[coercionKey];
            if (coercion) {
              setNestedValue(result, parts, coercion(value));
            }
          }
        }
        break;
      }

      case 'add_default': {
        if (getNestedValue(result, parts) === undefined) {
          setNestedValue(result, parts, step.details.default ?? null);
        }
        break;
      }

      default:
        break;
    }

    return result;
  }

  private changeToStep(change: SchemaChange): MigrationStep {
    switch (change.type) {
      case 'field_added':
        return {
          type: 'add_field',
          field: change.path,
          description: change.description,
          safe: change.safe,
          details: {
            default: change.current?.default ?? null,
            required: change.current?.required ?? false,
          },
        };

      case 'field_removed':
        return {
          type: 'remove_field',
          field: change.path,
          description: change.description,
          safe: change.safe,
          details: {},
        };

      case 'field_type_changed': {
        const fromType = Array.isArray(change.previous?.type)
          ? change.previous!.type[0]!
          : change.previous?.type;
        const toType = Array.isArray(change.current?.type)
          ? change.current!.type[0]!
          : change.current?.type;
        return {
          type: 'change_type',
          field: change.path,
          description: change.description,
          safe: change.safe,
          details: { fromType, toType },
        };
      }

      case 'field_required_changed':
        return {
          type: 'add_default',
          field: change.path,
          description: change.description,
          safe: change.safe,
          details: {
            default: change.current?.default ?? null,
            required: change.current?.required ?? false,
          },
        };

      default:
        return {
          type: 'add_default',
          field: change.path,
          description: change.description,
          safe: change.safe,
          details: {},
        };
    }
  }
}

function getNestedValue(obj: Record<string, unknown>, parts: string[]): unknown {
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function setNestedValue(obj: Record<string, unknown>, parts: string[], value: unknown): void {
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (!(part in current) || typeof current[part] !== 'object' || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  const lastPart = parts[parts.length - 1]!;
  current[lastPart] = value;
}

function deleteNestedValue(obj: Record<string, unknown>, parts: string[]): void {
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (typeof current[part] !== 'object' || current[part] === null) return;
    current = current[part] as Record<string, unknown>;
  }
  const lastPart = parts[parts.length - 1]!;
  delete current[lastPart];
}

/**
 * Create a new auto-migration engine.
 *
 * @example
 * ```typescript
 * const engine = createAutoMigrationEngine(registry);
 * const result = await engine.migrate('users', docs, 1, 2);
 * ```
 */
export function createAutoMigrationEngine(registry: SchemaVersionRegistry): AutoMigrationEngine {
  return new AutoMigrationEngine(registry);
}
