/**
 * Migration generator that compares schema versions and produces
 * executable migration steps with rollback support.
 *
 * @module
 */

import type { InferredSchema, InferredField, InferredFieldType } from './types.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Supported migration step operations */
export type MigrationStepType =
  | 'add-field'
  | 'remove-field'
  | 'rename-field'
  | 'change-type'
  | 'add-index'
  | 'remove-index';

/** A single migration step */
export interface MigrationStep {
  readonly type: MigrationStepType;
  readonly fieldPath: string;
  readonly description: string;
  readonly breaking: boolean;
  readonly details: Readonly<Record<string, unknown>>;
}

/** A complete migration plan */
export interface MigrationPlan {
  readonly steps: readonly MigrationStep[];
  readonly hasBreakingChanges: boolean;
  readonly summary: string;
}

/** Generated migration script */
export interface MigrationScript {
  readonly up: string;
  readonly down: string;
  readonly plan: MigrationPlan;
}

/** Configuration for migration generation */
export interface MigrationGeneratorConfig {
  /** Collection/table name used in generated scripts */
  readonly collectionName: string;
  /** Field rename detection threshold (0-1). If similarity >= threshold, treat as rename. */
  readonly renameSimilarityThreshold: number;
}

const DEFAULT_MIGRATION_CONFIG: MigrationGeneratorConfig = {
  collectionName: 'collection',
  renameSimilarityThreshold: 0.6,
};

// ─── Utilities ───────────────────────────────────────────────────────────────

/** Simple string similarity (Sørensen-Dice coefficient on bigrams) */
function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigramsA = new Set<string>();
  for (let i = 0; i < a.length - 1; i++) {
    bigramsA.add(a.slice(i, i + 2).toLowerCase());
  }

  const bigramsB = new Set<string>();
  for (let i = 0; i < b.length - 1; i++) {
    bigramsB.add(b.slice(i, i + 2).toLowerCase());
  }

  let intersection = 0;
  for (const bigram of bigramsA) {
    if (bigramsB.has(bigram)) intersection++;
  }

  return (2 * intersection) / (bigramsA.size + bigramsB.size);
}

function typeToString(type: InferredFieldType): string {
  return type;
}

function indent(code: string, level: number): string {
  const prefix = '  '.repeat(level);
  return code
    .split('\n')
    .map(line => (line.trim() ? prefix + line : line))
    .join('\n');
}

// ─── Diff Detection ─────────────────────────────────────────────────────────

/** Detect renamed fields by matching removed and added fields by similarity + type */
function detectRenames(
  removed: Map<string, InferredField>,
  added: Map<string, InferredField>,
  threshold: number,
): Array<{ oldName: string; newName: string; field: InferredField }> {
  const renames: Array<{ oldName: string; newName: string; field: InferredField }> = [];
  const matchedOld = new Set<string>();
  const matchedNew = new Set<string>();

  for (const [oldName, oldField] of removed) {
    let bestMatch: string | null = null;
    let bestScore = 0;

    for (const [newName, newField] of added) {
      if (matchedNew.has(newName)) continue;
      if (oldField.type !== newField.type) continue;

      const score = stringSimilarity(oldName, newName);
      if (score > bestScore && score >= threshold) {
        bestScore = score;
        bestMatch = newName;
      }
    }

    if (bestMatch) {
      renames.push({ oldName, newName: bestMatch, field: added.get(bestMatch)! });
      matchedOld.add(oldName);
      matchedNew.add(bestMatch);
    }
  }

  return renames;
}

/** Compare two schemas and produce migration steps */
function diffSchemas(
  oldSchema: InferredSchema,
  newSchema: InferredSchema,
  config: MigrationGeneratorConfig,
): MigrationStep[] {
  const steps: MigrationStep[] = [];

  const oldFields = new Map(oldSchema.fields);
  const newFields = new Map(newSchema.fields);

  // Identify removed and added fields
  const removedFields = new Map<string, InferredField>();
  const addedFields = new Map<string, InferredField>();

  for (const [name, field] of oldFields) {
    if (!newFields.has(name)) {
      removedFields.set(name, field);
    }
  }

  for (const [name, field] of newFields) {
    if (!oldFields.has(name)) {
      addedFields.set(name, field);
    }
  }

  // Detect renames from removed → added
  const renames = detectRenames(
    removedFields,
    addedFields,
    config.renameSimilarityThreshold,
  );

  for (const { oldName, newName } of renames) {
    removedFields.delete(oldName);
    addedFields.delete(newName);
    steps.push({
      type: 'rename-field',
      fieldPath: oldName,
      description: `Rename field '${oldName}' to '${newName}'`,
      breaking: true,
      details: { oldName, newName },
    });
  }

  // Remaining removed fields
  for (const [name, field] of removedFields) {
    steps.push({
      type: 'remove-field',
      fieldPath: name,
      description: `Remove field '${name}' (was ${typeToString(field.type)})`,
      breaking: true,
      details: { type: field.type },
    });
  }

  // Remaining added fields
  for (const [name, field] of addedFields) {
    steps.push({
      type: 'add-field',
      fieldPath: name,
      description: `Add field '${name}' (${typeToString(field.type)}${field.required ? ', required' : ', optional'})`,
      breaking: field.required,
      details: {
        type: field.type,
        required: field.required,
        nullable: field.nullable,
      },
    });
  }

  // Type changes for fields present in both
  for (const [name, newField] of newFields) {
    const oldField = oldFields.get(name);
    if (!oldField) continue;
    if (removedFields.has(name)) continue;

    if (oldField.type !== newField.type) {
      steps.push({
        type: 'change-type',
        fieldPath: name,
        description: `Change type of '${name}' from ${typeToString(oldField.type)} to ${typeToString(newField.type)}`,
        breaking: true,
        details: {
          oldType: oldField.type,
          newType: newField.type,
        },
      });
    }
  }

  return steps;
}

// ─── Script Generation ───────────────────────────────────────────────────────

function generateUpScript(steps: readonly MigrationStep[], _collectionName: string): string {
  const lines: string[] = [];
  lines.push(`// Migration: UP`);
  lines.push(`// Generated at ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`import type { Collection } from '@pocket/core';`);
  lines.push('');
  lines.push(`export async function up(collection: Collection): Promise<void> {`);

  if (steps.length === 0) {
    lines.push(`  // No changes detected`);
  }

  for (const step of steps) {
    lines.push(`  // ${step.description}`);
    switch (step.type) {
      case 'add-field':
        lines.push(indent(
          `await collection.updateMany({}, { $set: { '${step.fieldPath}': ${step.details['nullable'] ? 'null' : 'undefined'} } });`,
          1,
        ));
        break;
      case 'remove-field':
        lines.push(indent(
          `await collection.updateMany({}, { $unset: { '${step.fieldPath}': '' } });`,
          1,
        ));
        break;
      case 'rename-field':
        lines.push(indent(
          `await collection.updateMany({}, { $rename: { '${step.details['oldName']}': '${step.details['newName']}' } });`,
          1,
        ));
        break;
      case 'change-type':
        lines.push(indent(
          `// Manual migration needed: convert '${step.fieldPath}' from ${String(step.details['oldType'])} to ${String(step.details['newType'])}`,
          1,
        ));
        lines.push(indent(
          `// await collection.find({}).forEach(doc => { ... });`,
          1,
        ));
        break;
      case 'add-index':
        lines.push(indent(
          `await collection.createIndex({ '${step.fieldPath}': 1 });`,
          1,
        ));
        break;
      case 'remove-index':
        lines.push(indent(
          `await collection.dropIndex('${step.fieldPath}_1');`,
          1,
        ));
        break;
    }
    lines.push('');
  }

  lines.push('}');
  return lines.join('\n');
}

function generateDownScript(steps: readonly MigrationStep[], _collectionName: string): string {
  const lines: string[] = [];
  lines.push(`// Migration: DOWN (Rollback)`);
  lines.push(`// Generated at ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`import type { Collection } from '@pocket/core';`);
  lines.push('');
  lines.push(`export async function down(collection: Collection): Promise<void> {`);

  // Reverse the steps for rollback
  const reversed = [...steps].reverse();

  if (reversed.length === 0) {
    lines.push(`  // No changes to roll back`);
  }

  for (const step of reversed) {
    lines.push(`  // Rollback: ${step.description}`);
    switch (step.type) {
      case 'add-field':
        lines.push(indent(
          `await collection.updateMany({}, { $unset: { '${step.fieldPath}': '' } });`,
          1,
        ));
        break;
      case 'remove-field':
        lines.push(indent(
          `// Cannot fully restore removed field '${step.fieldPath}' - data was lost`,
          1,
        ));
        lines.push(indent(
          `await collection.updateMany({}, { $set: { '${step.fieldPath}': null } });`,
          1,
        ));
        break;
      case 'rename-field':
        lines.push(indent(
          `await collection.updateMany({}, { $rename: { '${step.details['newName']}': '${step.details['oldName']}' } });`,
          1,
        ));
        break;
      case 'change-type':
        lines.push(indent(
          `// Manual rollback needed: convert '${step.fieldPath}' from ${String(step.details['newType'])} back to ${String(step.details['oldType'])}`,
          1,
        ));
        break;
      case 'add-index':
        lines.push(indent(
          `await collection.dropIndex('${step.fieldPath}_1');`,
          1,
        ));
        break;
      case 'remove-index':
        lines.push(indent(
          `await collection.createIndex({ '${step.fieldPath}': 1 });`,
          1,
        ));
        break;
    }
    lines.push('');
  }

  lines.push('}');
  return lines.join('\n');
}

// ─── Migration Generator ────────────────────────────────────────────────────

/**
 * Generates migration plans and scripts by comparing two schema versions.
 * Supports add, remove, rename, change type, and index operations with
 * rollback script generation.
 *
 * @example
 * ```typescript
 * const generator = createMigrationGenerator({ collectionName: 'users' });
 *
 * const plan = generator.plan(oldSchema, newSchema);
 * console.log(plan.summary);
 * console.log(plan.hasBreakingChanges);
 *
 * const script = generator.generate(oldSchema, newSchema);
 * console.log(script.up);   // Migration script
 * console.log(script.down); // Rollback script
 * ```
 */
export class MigrationGenerator {
  private readonly config: MigrationGeneratorConfig;

  constructor(config: Partial<MigrationGeneratorConfig> = {}) {
    this.config = { ...DEFAULT_MIGRATION_CONFIG, ...config };
  }

  /**
   * Generate a migration plan describing all changes between two schemas.
   */
  plan(oldSchema: InferredSchema, newSchema: InferredSchema): MigrationPlan {
    const steps = diffSchemas(oldSchema, newSchema, this.config);
    const hasBreakingChanges = steps.some(s => s.breaking);

    const summary = this.buildSummary(steps, hasBreakingChanges);
    return { steps, hasBreakingChanges, summary };
  }

  /**
   * Generate executable migration scripts (up and down) between two schemas.
   */
  generate(oldSchema: InferredSchema, newSchema: InferredSchema): MigrationScript {
    const migrationPlan = this.plan(oldSchema, newSchema);
    const up = generateUpScript(migrationPlan.steps, this.config.collectionName);
    const down = generateDownScript(migrationPlan.steps, this.config.collectionName);

    return { up, down, plan: migrationPlan };
  }

  /**
   * Preview migration changes as a human-readable dry-run description.
   */
  preview(oldSchema: InferredSchema, newSchema: InferredSchema): string {
    const migrationPlan = this.plan(oldSchema, newSchema);
    const lines: string[] = [];

    lines.push(`Migration Preview for '${this.config.collectionName}'`);
    lines.push('='.repeat(50));
    lines.push('');

    if (migrationPlan.steps.length === 0) {
      lines.push('No changes detected.');
      return lines.join('\n');
    }

    if (migrationPlan.hasBreakingChanges) {
      lines.push('⚠️  WARNING: This migration contains breaking changes');
      lines.push('');
    }

    for (const step of migrationPlan.steps) {
      const icon = step.breaking ? '🔴' : '🟢';
      lines.push(`${icon} [${step.type}] ${step.description}`);
    }

    lines.push('');
    lines.push(migrationPlan.summary);

    return lines.join('\n');
  }

  private buildSummary(steps: readonly MigrationStep[], hasBreaking: boolean): string {
    const counts = new Map<MigrationStepType, number>();
    for (const step of steps) {
      counts.set(step.type, (counts.get(step.type) ?? 0) + 1);
    }

    const parts: string[] = [];
    for (const [type, count] of counts) {
      parts.push(`${count} ${type}`);
    }

    const changeList = parts.length > 0 ? parts.join(', ') : 'no changes';
    const breakingNote = hasBreaking ? ' (includes breaking changes)' : '';
    return `${steps.length} migration step(s): ${changeList}${breakingNote}`;
  }
}

/** Factory function to create a MigrationGenerator. */
export function createMigrationGenerator(
  config?: Partial<MigrationGeneratorConfig>,
): MigrationGenerator {
  return new MigrationGenerator(config);
}
