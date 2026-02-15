/**
 * Schema Diff Analyzer for Pocket Migrations
 *
 * Compares schema versions and generates migration steps automatically.
 * Detects field additions, removals, renames, type changes, and structural changes.
 *
 * @module schema-diff
 *
 * @example
 * ```typescript
 * import { createSchemaDiffAnalyzer } from '@pocket/migration';
 *
 * const analyzer = createSchemaDiffAnalyzer({ renameThreshold: 0.7 });
 * const diffs = analyzer.diff(oldSchema, newSchema);
 * const plan = analyzer.generateMigrationPlan(oldSchema, newSchema);
 *
 * console.log(`Migration has ${plan.steps.length} steps`);
 * console.log(`Destructive: ${plan.isDestructive}`);
 * ```
 *
 * @see {@link MigrationRunner} for executing migration plans
 */

import { Subject, type Observable } from 'rxjs';

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
 * Classification of a schema change.
 *
 * - `'field-added'`: A field was added to a collection
 * - `'field-removed'`: A field was removed from a collection
 * - `'field-renamed'`: A field was renamed in a collection
 * - `'field-type-changed'`: A field's type was changed
 * - `'field-default-changed'`: A field's default value was changed
 * - `'index-added'`: An index was added to a collection
 * - `'index-removed'`: An index was removed from a collection
 * - `'collection-added'`: A new collection was added
 * - `'collection-removed'`: A collection was removed
 */
export type SchemaDiffType =
  | 'field-added'
  | 'field-removed'
  | 'field-renamed'
  | 'field-type-changed'
  | 'field-default-changed'
  | 'index-added'
  | 'index-removed'
  | 'collection-added'
  | 'collection-removed';

/**
 * Top-level schema definition containing all collections.
 *
 * @example
 * ```typescript
 * const schema: SchemaDefinition = {
 *   version: 2,
 *   collections: {
 *     users: {
 *       name: 'users',
 *       fields: { email: { type: 'string', required: true } },
 *     },
 *   },
 * };
 * ```
 */
export interface SchemaDefinition {
  /** Map of collection name to its schema definition */
  collections: Record<string, CollectionSchema>;

  /** Schema version number */
  version: number;
}

/**
 * Schema definition for a single collection.
 *
 * @see {@link SchemaDefinition.collections}
 */
export interface CollectionSchema {
  /** Collection name */
  name: string;

  /** Map of field name to its schema */
  fields: Record<string, FieldSchema>;

  /** Optional indexes defined on the collection */
  indexes?: IndexSchema[];

  /** Optional primary key field name */
  primaryKey?: string;
}

/**
 * Schema definition for a single field.
 *
 * @see {@link CollectionSchema.fields}
 */
export interface FieldSchema {
  /** Data type of the field */
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'date' | 'binary';

  /** Whether the field is required */
  required?: boolean;

  /** Default value when the field is missing */
  default?: unknown;

  /** Human-readable description of the field */
  description?: string;
}

/**
 * Index definition for a collection.
 *
 * @see {@link CollectionSchema.indexes}
 */
export interface IndexSchema {
  /** Fields included in the index */
  fields: string[];

  /** Whether the index enforces uniqueness */
  unique?: boolean;

  /** Optional index name */
  name?: string;
}

/**
 * A single detected difference between two schema versions.
 *
 * @see {@link SchemaDiffAnalyzer.diff}
 */
export interface SchemaDiff {
  /** Type of change detected */
  type: SchemaDiffType;

  /** Collection affected by the change */
  collection: string;

  /** Field affected by the change, if applicable */
  field?: string;

  /** Additional details about the change */
  details: {
    /** Value before the change */
    before?: unknown;
    /** Value after the change */
    after?: unknown;
    /** Confidence score for the detection (0-1) */
    confidence: number;
    /** Suggested action or warning */
    suggestion?: string;
  };
}

/**
 * A single executable migration step.
 *
 * @see {@link MigrationPlan.steps}
 */
export interface MigrationStep {
  /** Unique identifier for this step */
  id: string;

  /** Execution order (0-based) */
  order: number;

  /** Type of operation to perform */
  type:
    | 'addField'
    | 'removeField'
    | 'renameField'
    | 'changeType'
    | 'addIndex'
    | 'removeIndex'
    | 'addCollection'
    | 'removeCollection'
    | 'transformData';

  /** Target collection */
  collection: string;

  /** Target field, if applicable */
  field?: string;

  /** Operation-specific parameters */
  params: Record<string, unknown>;

  /** Whether this step can be reversed */
  reversible: boolean;

  /** Inverse step for rollback, if reversible */
  inverseStep?: Omit<MigrationStep, 'inverseStep'>;

  /** Human-readable description of the step */
  description: string;
}

/**
 * A complete migration plan generated from a schema diff.
 *
 * @example
 * ```typescript
 * const plan = analyzer.generateMigrationPlan(v1, v2);
 * if (plan.isDestructive) {
 *   console.warn('Destructive changes:', plan.warnings);
 * }
 * ```
 *
 * @see {@link SchemaDiffAnalyzer.generateMigrationPlan}
 */
export interface MigrationPlan {
  /** Unique identifier for this plan */
  id: string;

  /** Source schema version */
  fromVersion: number;

  /** Target schema version */
  toVersion: number;

  /** Ordered list of migration steps */
  steps: MigrationStep[];

  /** Estimated number of documents affected */
  estimatedDocuments: number;

  /** Whether the plan contains destructive changes */
  isDestructive: boolean;

  /** Warnings about potentially dangerous operations */
  warnings: string[];

  /** Timestamp when the plan was created */
  createdAt: number;
}

/**
 * Configuration for the schema diff analyzer.
 *
 * @example
 * ```typescript
 * const config: SchemaDiffConfig = {
 *   renameThreshold: 0.8,
 *   generateRollback: true,
 *   warnOnDestructive: true,
 * };
 * ```
 *
 * @see {@link SchemaDiffAnalyzer}
 */
export interface SchemaDiffConfig {
  /**
   * Similarity threshold for rename detection (0-1).
   * Fields with similarity above this threshold are treated as renames.
   * @default 0.6
   */
  renameThreshold?: number;

  /**
   * Generate inverse steps for rollback support.
   * @default true
   */
  generateRollback?: boolean;

  /**
   * Emit warnings for destructive changes.
   * @default true
   */
  warnOnDestructive?: boolean;
}

// ---------------------------------------------------------------------------
// SchemaDiffAnalyzer
// ---------------------------------------------------------------------------

/**
 * Analyzes differences between two schema versions and generates
 * executable migration plans.
 *
 * Supports detection of field additions, removals, renames (via
 * similarity scoring), type changes, default value changes, index
 * changes, and collection-level additions/removals.
 *
 * @example Basic diff
 * ```typescript
 * const analyzer = createSchemaDiffAnalyzer();
 * const diffs = analyzer.diff(schemaV1, schemaV2);
 * diffs.forEach(d => console.log(`${d.type} on ${d.collection}.${d.field}`));
 * ```
 *
 * @example Generate a migration plan
 * ```typescript
 * const analyzer = createSchemaDiffAnalyzer({ renameThreshold: 0.7 });
 * const plan = analyzer.generateMigrationPlan(schemaV1, schemaV2);
 * console.log(`${plan.steps.length} steps, destructive: ${plan.isDestructive}`);
 * ```
 *
 * @see {@link MigrationPlan}
 * @see {@link SchemaDiff}
 */
export class SchemaDiffAnalyzer {
  private readonly config: Required<SchemaDiffConfig>;
  private readonly diffSubject = new Subject<SchemaDiff[]>();
  private disposed = false;

  /**
   * Observable stream of diff results.
   *
   * Emits the diff array each time {@link diff} is called.
   *
   * @example
   * ```typescript
   * analyzer.diff$.subscribe(diffs => {
   *   console.log(`Detected ${diffs.length} changes`);
   * });
   * ```
   */
  readonly diff$: Observable<SchemaDiff[]> = this.diffSubject.asObservable();

  /**
   * Creates a new SchemaDiffAnalyzer.
   *
   * @param config - Optional configuration overrides
   */
  constructor(config?: SchemaDiffConfig) {
    this.config = {
      renameThreshold: 0.6,
      generateRollback: true,
      warnOnDestructive: true,
      ...config,
    };
  }

  /**
   * Compares two schema definitions and returns all detected differences.
   *
   * @param before - The original schema version
   * @param after - The target schema version
   * @returns Array of detected schema diffs
   *
   * @example
   * ```typescript
   * const diffs = analyzer.diff(schemaV1, schemaV2);
   * const additions = diffs.filter(d => d.type === 'field-added');
   * ```
   */
  diff(before: SchemaDefinition, after: SchemaDefinition): SchemaDiff[] {
    const diffs: SchemaDiff[] = [];

    const beforeNames = new Set(Object.keys(before.collections));
    const afterNames = new Set(Object.keys(after.collections));

    // Detect added collections
    for (const name of afterNames) {
      if (!beforeNames.has(name)) {
        diffs.push({
          type: 'collection-added',
          collection: name,
          details: {
            after: after.collections[name],
            confidence: 1,
            suggestion: `Create collection "${name}"`,
          },
        });
      }
    }

    // Detect removed collections
    for (const name of beforeNames) {
      if (!afterNames.has(name)) {
        diffs.push({
          type: 'collection-removed',
          collection: name,
          details: {
            before: before.collections[name],
            confidence: 1,
            suggestion: `Remove collection "${name}" — this is destructive`,
          },
        });
      }
    }

    // Diff shared collections
    for (const name of beforeNames) {
      if (afterNames.has(name)) {
        const collectionDiffs = this.diffCollection(
          before.collections[name]!,
          after.collections[name]!,
          name
        );
        diffs.push(...collectionDiffs);
      }
    }

    this.diffSubject.next(diffs);
    return diffs;
  }

  /**
   * Generates a complete migration plan from two schema versions.
   *
   * Internally calls {@link diff} and converts each detected change into
   * an ordered {@link MigrationStep}.
   *
   * @param before - The original schema version
   * @param after - The target schema version
   * @returns A complete migration plan
   *
   * @example
   * ```typescript
   * const plan = analyzer.generateMigrationPlan(v1, v2);
   * for (const step of plan.steps) {
   *   console.log(`Step ${step.order}: ${step.description}`);
   * }
   * ```
   */
  generateMigrationPlan(before: SchemaDefinition, after: SchemaDefinition): MigrationPlan {
    const diffs = this.diff(before, after);
    const steps = diffs.map((d, i) => this.generateStep(d, i));
    const warnings: string[] = [];

    if (this.config.warnOnDestructive) {
      for (const d of diffs) {
        if (d.type === 'field-removed' || d.type === 'collection-removed') {
          warnings.push(`Destructive: ${d.type} on ${d.collection}${d.field ? `.${d.field}` : ''}`);
        }
        if (d.type === 'field-type-changed') {
          warnings.push(`Type change on ${d.collection}.${d.field} may cause data loss`);
        }
      }
    }

    return {
      id: generateId(),
      fromVersion: before.version,
      toVersion: after.version,
      steps,
      estimatedDocuments: 0,
      isDestructive: this.isDestructive(diffs),
      warnings,
      createdAt: Date.now(),
    };
  }

  /**
   * Detects potential field renames between two collection versions
   * by comparing removed and added fields using similarity scoring.
   *
   * @param before - The original collection schema
   * @param after - The updated collection schema
   * @returns Array of rename candidates with confidence scores
   *
   * @example
   * ```typescript
   * const renames = analyzer.detectRenames(oldUsers, newUsers);
   * renames.forEach(r =>
   *   console.log(`${r.from} → ${r.to} (confidence: ${r.confidence})`),
   * );
   * ```
   */
  detectRenames(
    before: CollectionSchema,
    after: CollectionSchema
  ): { from: string; to: string; confidence: number }[] {
    const beforeFields = Object.keys(before.fields);
    const afterFields = Object.keys(after.fields);

    const removed = beforeFields.filter((f) => !afterFields.includes(f));
    const added = afterFields.filter((f) => !beforeFields.includes(f));

    const renames: { from: string; to: string; confidence: number }[] = [];
    const usedAdded = new Set<string>();

    for (const oldName of removed) {
      let bestMatch: string | null = null;
      let bestScore = 0;

      for (const newName of added) {
        if (usedAdded.has(newName)) continue;

        const score = this.calculateFieldSimilarity(
          oldName,
          before.fields[oldName]!,
          newName,
          after.fields[newName]!
        );

        if (score > bestScore && score >= this.config.renameThreshold) {
          bestScore = score;
          bestMatch = newName;
        }
      }

      if (bestMatch) {
        usedAdded.add(bestMatch);
        renames.push({ from: oldName, to: bestMatch, confidence: bestScore });
      }
    }

    return renames;
  }

  /**
   * Checks whether any of the given diffs represent destructive changes.
   *
   * @param diffs - Array of schema diffs to check
   * @returns `true` if at least one diff is destructive
   *
   * @example
   * ```typescript
   * if (analyzer.isDestructive(diffs)) {
   *   console.warn('Migration contains destructive changes');
   * }
   * ```
   */
  isDestructive(diffs: SchemaDiff[]): boolean {
    return diffs.some(
      (d) =>
        d.type === 'field-removed' ||
        d.type === 'collection-removed' ||
        d.type === 'field-type-changed'
    );
  }

  /**
   * Compares two collection schemas and returns detected differences.
   */
  private diffCollection(
    before: CollectionSchema,
    after: CollectionSchema,
    collectionName: string
  ): SchemaDiff[] {
    const diffs: SchemaDiff[] = [];

    const beforeFields = new Set(Object.keys(before.fields));
    const afterFields = new Set(Object.keys(after.fields));

    // Detect renames first so we can exclude them from add/remove
    const renames = this.detectRenames(before, after);
    const renamedFrom = new Set(renames.map((r) => r.from));
    const renamedTo = new Set(renames.map((r) => r.to));

    for (const rename of renames) {
      diffs.push({
        type: 'field-renamed',
        collection: collectionName,
        field: rename.to,
        details: {
          before: rename.from,
          after: rename.to,
          confidence: rename.confidence,
          suggestion: `Rename field "${rename.from}" to "${rename.to}"`,
        },
      });
    }

    // Detect added fields (excluding rename targets)
    for (const name of afterFields) {
      if (!beforeFields.has(name) && !renamedTo.has(name)) {
        diffs.push({
          type: 'field-added',
          collection: collectionName,
          field: name,
          details: {
            after: after.fields[name],
            confidence: 1,
            suggestion: `Add field "${name}" to "${collectionName}"`,
          },
        });
      }
    }

    // Detect removed fields (excluding rename sources)
    for (const name of beforeFields) {
      if (!afterFields.has(name) && !renamedFrom.has(name)) {
        diffs.push({
          type: 'field-removed',
          collection: collectionName,
          field: name,
          details: {
            before: before.fields[name],
            confidence: 1,
            suggestion: `Remove field "${name}" from "${collectionName}" — this is destructive`,
          },
        });
      }
    }

    // Detect type and default changes on shared fields
    for (const name of beforeFields) {
      if (!afterFields.has(name)) continue;
      if (renamedFrom.has(name)) continue;

      const beforeField = before.fields[name]!;
      const afterField = after.fields[name]!;

      if (beforeField.type !== afterField.type) {
        diffs.push({
          type: 'field-type-changed',
          collection: collectionName,
          field: name,
          details: {
            before: beforeField.type,
            after: afterField.type,
            confidence: 1,
            suggestion: `Change type of "${name}" from "${beforeField.type}" to "${afterField.type}"`,
          },
        });
      }

      if (JSON.stringify(beforeField.default) !== JSON.stringify(afterField.default)) {
        diffs.push({
          type: 'field-default-changed',
          collection: collectionName,
          field: name,
          details: {
            before: beforeField.default,
            after: afterField.default,
            confidence: 1,
          },
        });
      }
    }

    // Detect index changes
    const beforeIndexes = before.indexes ?? [];
    const afterIndexes = after.indexes ?? [];

    const indexKey = (idx: IndexSchema): string => `${idx.fields.join(',')}:${idx.unique ?? false}`;

    const beforeIndexKeys = new Set(beforeIndexes.map(indexKey));
    const afterIndexKeys = new Set(afterIndexes.map(indexKey));

    for (const idx of afterIndexes) {
      if (!beforeIndexKeys.has(indexKey(idx))) {
        diffs.push({
          type: 'index-added',
          collection: collectionName,
          details: {
            after: idx,
            confidence: 1,
            suggestion: `Add index on (${idx.fields.join(', ')})`,
          },
        });
      }
    }

    for (const idx of beforeIndexes) {
      if (!afterIndexKeys.has(indexKey(idx))) {
        diffs.push({
          type: 'index-removed',
          collection: collectionName,
          details: {
            before: idx,
            confidence: 1,
            suggestion: `Remove index on (${idx.fields.join(', ')})`,
          },
        });
      }
    }

    return diffs;
  }

  /**
   * Converts a single schema diff into a migration step.
   */
  private generateStep(diff: SchemaDiff, order: number): MigrationStep {
    const base = {
      id: generateId(),
      order,
      collection: diff.collection,
      field: diff.field,
      params: {} as Record<string, unknown>,
      description: '',
      reversible: false,
      inverseStep: undefined as Omit<MigrationStep, 'inverseStep'> | undefined,
    };

    switch (diff.type) {
      case 'field-added': {
        const step: MigrationStep = {
          ...base,
          type: 'addField',
          params: { fieldSchema: diff.details.after },
          reversible: true,
          description: `Add field "${diff.field}" to "${diff.collection}"`,
        };
        if (this.config.generateRollback) {
          step.inverseStep = {
            id: generateId(),
            order,
            type: 'removeField',
            collection: diff.collection,
            field: diff.field,
            params: {},
            reversible: false,
            description: `Remove field "${diff.field}" from "${diff.collection}"`,
          };
        }
        return step;
      }

      case 'field-removed': {
        const step: MigrationStep = {
          ...base,
          type: 'removeField',
          params: { fieldSchema: diff.details.before },
          reversible: true,
          description: `Remove field "${diff.field}" from "${diff.collection}"`,
        };
        if (this.config.generateRollback) {
          step.inverseStep = {
            id: generateId(),
            order,
            type: 'addField',
            collection: diff.collection,
            field: diff.field,
            params: { fieldSchema: diff.details.before },
            reversible: false,
            description: `Re-add field "${diff.field}" to "${diff.collection}"`,
          };
        }
        return step;
      }

      case 'field-renamed': {
        const step: MigrationStep = {
          ...base,
          type: 'renameField',
          params: { from: diff.details.before, to: diff.details.after },
          reversible: true,
          description: `Rename field "${diff.details.before}" to "${diff.details.after}" in "${diff.collection}"`,
        };
        if (this.config.generateRollback) {
          step.inverseStep = {
            id: generateId(),
            order,
            type: 'renameField',
            collection: diff.collection,
            field: diff.field,
            params: { from: diff.details.after, to: diff.details.before },
            reversible: false,
            description: `Rename field "${diff.details.after}" back to "${diff.details.before}" in "${diff.collection}"`,
          };
        }
        return step;
      }

      case 'field-type-changed':
        return {
          ...base,
          type: 'changeType',
          params: { from: diff.details.before, to: diff.details.after },
          reversible: false,
          description: `Change type of "${diff.field}" from "${diff.details.before}" to "${diff.details.after}" in "${diff.collection}"`,
        };

      case 'field-default-changed':
        return {
          ...base,
          type: 'transformData',
          params: { from: diff.details.before, to: diff.details.after },
          reversible: true,
          description: `Update default value of "${diff.field}" in "${diff.collection}"`,
        };

      case 'index-added': {
        const step: MigrationStep = {
          ...base,
          type: 'addIndex',
          params: { index: diff.details.after },
          reversible: true,
          description: `Add index on "${diff.collection}"`,
        };
        if (this.config.generateRollback) {
          step.inverseStep = {
            id: generateId(),
            order,
            type: 'removeIndex',
            collection: diff.collection,
            params: { index: diff.details.after },
            reversible: false,
            description: `Remove index on "${diff.collection}"`,
          };
        }
        return step;
      }

      case 'index-removed': {
        const step: MigrationStep = {
          ...base,
          type: 'removeIndex',
          params: { index: diff.details.before },
          reversible: true,
          description: `Remove index on "${diff.collection}"`,
        };
        if (this.config.generateRollback) {
          step.inverseStep = {
            id: generateId(),
            order,
            type: 'addIndex',
            collection: diff.collection,
            params: { index: diff.details.before },
            reversible: false,
            description: `Re-add index on "${diff.collection}"`,
          };
        }
        return step;
      }

      case 'collection-added':
        return {
          ...base,
          type: 'addCollection',
          params: { schema: diff.details.after },
          reversible: true,
          description: `Add collection "${diff.collection}"`,
        };

      case 'collection-removed':
        return {
          ...base,
          type: 'removeCollection',
          params: { schema: diff.details.before },
          reversible: false,
          description: `Remove collection "${diff.collection}"`,
        };

      default:
        return {
          ...base,
          type: 'transformData',
          description: `Unknown diff type`,
        };
    }
  }

  /**
   * Calculates a similarity score between two fields based on name
   * similarity (Levenshtein-based) and type compatibility.
   */
  private calculateFieldSimilarity(
    nameA: string,
    typeA: FieldSchema,
    nameB: string,
    typeB: FieldSchema
  ): number {
    // Name similarity via normalised Levenshtein distance
    const maxLen = Math.max(nameA.length, nameB.length);
    if (maxLen === 0) return 1;

    const dist = this.levenshtein(nameA.toLowerCase(), nameB.toLowerCase());
    const nameSimilarity = 1 - dist / maxLen;

    // Type match bonus
    const typeScore = typeA.type === typeB.type ? 0.3 : 0;

    return Math.min(nameSimilarity * 0.7 + typeScore, 1);
  }

  /**
   * Computes the Levenshtein edit distance between two strings.
   */
  private levenshtein(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () =>
      Array.from({ length: n + 1 }, () => 0)
    );

    for (let i = 0; i <= m; i++) dp[i]![0] = i;
    for (let j = 0; j <= n; j++) dp[0]![j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost);
      }
    }

    return dp[m]![n]!;
  }

  /**
   * Releases internal resources.
   *
   * Completes the diff$ observable. The analyzer should not be used
   * after calling dispose.
   */
  dispose(): void {
    if (!this.disposed) {
      this.disposed = true;
      this.diffSubject.complete();
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a new {@link SchemaDiffAnalyzer} instance.
 *
 * @param config - Optional configuration overrides
 * @returns A configured SchemaDiffAnalyzer instance
 *
 * @example
 * ```typescript
 * const analyzer = createSchemaDiffAnalyzer({
 *   renameThreshold: 0.8,
 *   generateRollback: true,
 * });
 *
 * const plan = analyzer.generateMigrationPlan(schemaV1, schemaV2);
 * ```
 */
export function createSchemaDiffAnalyzer(config?: SchemaDiffConfig): SchemaDiffAnalyzer {
  return new SchemaDiffAnalyzer(config);
}
