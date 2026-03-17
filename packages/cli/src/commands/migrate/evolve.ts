/**
 * Schema Evolution Wizard — Interactive schema change detection and migration generation.
 *
 * Detects schema changes between versions, shows a visual diff,
 * previews migration impact, and generates migration files automatically.
 *
 * @example
 * ```bash
 * pocket migrate evolve --schema ./schemas.ts
 * pocket migrate evolve --dry-run
 * pocket migrate evolve --collection users
 * ```
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ── Types ──────────────────────────────────────────────────

export interface EvolveOptions {
  cwd?: string;
  collection?: string;
  dryRun?: boolean;
  allowLossy?: boolean;
  outputDir?: string;
}

export interface SchemaSnapshot {
  version: number;
  timestamp: number;
  collections: Record<string, StoredSchema>;
}

export interface StoredSchema {
  version: number;
  properties: Record<string, StoredField>;
  additionalProperties?: boolean;
}

export interface StoredField {
  type: string | string[];
  required?: boolean;
  default?: unknown;
  min?: number;
  max?: number;
  pattern?: string;
  enum?: unknown[];
  properties?: Record<string, StoredField>;
  items?: StoredField;
}

export interface SchemaChange {
  type: string;
  path: string;
  safe: boolean;
  description: string;
}

export interface SchemaDiffResult {
  identical: boolean;
  changes: SchemaChange[];
  autoMigrateSafe: boolean;
  unsafeChanges: SchemaChange[];
  fromVersion: number;
  toVersion: number;
}

export interface EvolveResult {
  collection: string;
  diff: SchemaDiffResult;
  migrationGenerated: boolean;
  migrationPath: string | null;
  dryRun: boolean;
}

// ── Snapshot Management ────────────────────────────────────

const SNAPSHOT_DIR = '.pocket/schemas';

function getSnapshotDir(cwd: string): string {
  return path.join(cwd, SNAPSHOT_DIR);
}

function getLatestSnapshot(cwd: string): SchemaSnapshot | null {
  const dir = getSnapshotDir(cwd);
  if (!fs.existsSync(dir)) return null;

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) return null;

  const content = fs.readFileSync(path.join(dir, files[0]!), 'utf-8');
  return JSON.parse(content) as SchemaSnapshot;
}

function saveSnapshot(cwd: string, snapshot: SchemaSnapshot): string {
  const dir = getSnapshotDir(cwd);
  fs.mkdirSync(dir, { recursive: true });

  const filename = `v${snapshot.version}_${Date.now()}.json`;
  const filepath = path.join(dir, filename);
  fs.writeFileSync(filepath, JSON.stringify(snapshot, null, 2));
  return filepath;
}

// ── Diff Engine (portable — mirrors @pocket/core schema-evolution) ──

function diffSchemaProperties(
  basePath: string,
  fromProps: Record<string, StoredField>,
  toProps: Record<string, StoredField>,
  changes: SchemaChange[]
): void {
  const fromKeys = new Set(Object.keys(fromProps));
  const toKeys = new Set(Object.keys(toProps));

  for (const key of toKeys) {
    if (!fromKeys.has(key)) {
      const field = toProps[key]!;
      changes.push({
        type: 'field_added',
        path: basePath ? `${basePath}.${key}` : key,
        safe: !field.required || field.default !== undefined,
        description: `+ Added field "${key}"${field.default !== undefined ? ` (default: ${JSON.stringify(field.default)})` : ''}`,
      });
    }
  }

  for (const key of fromKeys) {
    if (!toKeys.has(key)) {
      changes.push({
        type: 'field_removed',
        path: basePath ? `${basePath}.${key}` : key,
        safe: true,
        description: `- Removed field "${key}"`,
      });
    }
  }

  for (const key of fromKeys) {
    if (!toKeys.has(key)) continue;
    const from = fromProps[key]!;
    const to = toProps[key]!;
    const p = basePath ? `${basePath}.${key}` : key;

    const fromType = Array.isArray(from.type) ? from.type.sort().join('|') : from.type;
    const toType = Array.isArray(to.type) ? to.type.sort().join('|') : to.type;

    if (fromType !== toType) {
      changes.push({
        type: 'field_type_changed',
        path: p,
        safe: false,
        description: `~ Changed "${key}" type: ${fromType} → ${toType}`,
      });
    }

    if (Boolean(from.required) !== Boolean(to.required)) {
      changes.push({
        type: 'field_required_changed',
        path: p,
        safe: !to.required || to.default !== undefined,
        description: to.required ? `! "${key}" is now required` : `  "${key}" is now optional`,
      });
    }

    if (from.properties && to.properties) {
      diffSchemaProperties(p, from.properties, to.properties, changes);
    }
  }
}

function diffStoredSchemas(from: StoredSchema, to: StoredSchema): SchemaDiffResult {
  const changes: SchemaChange[] = [];
  diffSchemaProperties('', from.properties, to.properties, changes);
  const unsafeChanges = changes.filter((c) => !c.safe);

  return {
    identical: changes.length === 0,
    changes,
    autoMigrateSafe: unsafeChanges.length === 0,
    unsafeChanges,
    fromVersion: from.version,
    toVersion: to.version,
  };
}

// ── Visual Diff Formatter ──────────────────────────────────

function formatDiff(collection: string, diff: SchemaDiffResult): string {
  const lines: string[] = [];
  lines.push(`\n  Schema Diff: "${collection}" (v${diff.fromVersion} → v${diff.toVersion})`);
  lines.push('  ' + '─'.repeat(50));

  if (diff.identical) {
    lines.push('  ✓ No changes detected');
    return lines.join('\n');
  }

  for (const change of diff.changes) {
    const icon = change.safe ? '  ✓' : '  ⚠';
    lines.push(`${icon} ${change.description}`);
  }

  lines.push('  ' + '─'.repeat(50));
  const safeCount = diff.changes.length - diff.unsafeChanges.length;
  lines.push(`  ${safeCount} safe change(s), ${diff.unsafeChanges.length} unsafe change(s)`);

  if (diff.autoMigrateSafe) {
    lines.push('  ✓ All changes can be auto-migrated');
  } else {
    lines.push('  ⚠ Some changes require manual review (--allow-lossy to proceed)');
  }

  return lines.join('\n');
}

// ── Migration File Generator ──────────────────────────────

function generateMigrationFile(collection: string, diff: SchemaDiffResult): string {
  const lines: string[] = [];
  lines.push(`/**`);
  lines.push(
    ` * Auto-generated migration: ${collection} v${diff.fromVersion} → v${diff.toVersion}`
  );
  lines.push(` * Generated at: ${new Date().toISOString()}`);
  lines.push(` * Changes: ${diff.changes.length} (${diff.unsafeChanges.length} unsafe)`);
  lines.push(` */`);
  lines.push(``);
  lines.push(`import type { MigrationContext } from '@pocket/core';`);
  lines.push(``);
  lines.push(`export const version = ${diff.toVersion};`);
  lines.push(`export const collection = '${collection}';`);
  lines.push(``);
  lines.push(
    `export function up(doc: Record<string, unknown>, _ctx: MigrationContext): Record<string, unknown> {`
  );
  lines.push(`  const result = { ...doc };`);

  for (const change of diff.changes) {
    const field = change.path.split('.').pop()!;
    if (change.type === 'field_added') {
      lines.push(`  // ${change.description}`);
      const defaultValue = extractDefault(change.description);
      lines.push(`  if (result['${field}'] === undefined) {`);
      lines.push(`    result['${field}'] = ${defaultValue};`);
      lines.push(`  }`);
    } else if (change.type === 'field_removed') {
      lines.push(`  // ${change.description}`);
      lines.push(`  delete result['${field}'];`);
    } else if (change.type === 'field_type_changed') {
      lines.push(`  // ${change.description}`);
      const targetType = extractTargetType(change.description);
      lines.push(`  if (result['${field}'] !== undefined) {`);
      lines.push(`    result['${field}'] = ${generateCoercion(`result['${field}']`, targetType)};`);
      lines.push(`  }`);
    }
  }

  lines.push(`  return result;`);
  lines.push(`}`);
  lines.push(``);

  // Generate reverse migration
  lines.push(
    `export function down(doc: Record<string, unknown>, _ctx: MigrationContext): Record<string, unknown> {`
  );
  lines.push(`  const result = { ...doc };`);

  // Reverse each change
  for (const change of [...diff.changes].reverse()) {
    const field = change.path.split('.').pop()!;
    if (change.type === 'field_added') {
      lines.push(`  // Reverse: ${change.description}`);
      lines.push(`  delete result['${field}'];`);
    } else if (change.type === 'field_removed') {
      lines.push(`  // Reverse: ${change.description}`);
      lines.push(`  if (result['${field}'] === undefined) {`);
      lines.push(`    result['${field}'] = null;`);
      lines.push(`  }`);
    } else if (change.type === 'field_type_changed') {
      lines.push(`  // Reverse: ${change.description}`);
      const sourceType = extractSourceType(change.description);
      lines.push(`  if (result['${field}'] !== undefined) {`);
      lines.push(`    result['${field}'] = ${generateCoercion(`result['${field}']`, sourceType)};`);
      lines.push(`  }`);
    }
  }

  lines.push(`  return result;`);
  lines.push(`}`);

  return lines.join('\n');
}

/** Extract the default value from a change description like '+ Added field "x" (default: "hello")' */
function extractDefault(description: string): string {
  const match = /\(default:\s*(.+)\)/.exec(description);
  if (match?.[1]) return match[1];
  return 'null';
}

/** Extract target type from description like '~ Changed "x" type: string → number' */
function extractTargetType(description: string): string {
  const match = /→\s*(\S+)/.exec(description);
  return match?.[1] ?? 'unknown';
}

/** Extract source type from description like '~ Changed "x" type: string → number' */
function extractSourceType(description: string): string {
  const match = /type:\s*(\S+)\s*→/.exec(description);
  return match?.[1] ?? 'unknown';
}

/** Generate a type coercion expression for the target type */
function generateCoercion(expr: string, targetType: string): string {
  switch (targetType) {
    case 'string':
      return `String(${expr})`;
    case 'number':
      return `Number(${expr})`;
    case 'boolean':
      return `Boolean(${expr})`;
    case 'array':
      return `Array.isArray(${expr}) ? ${expr} : [${expr}]`;
    case 'object':
      return `typeof ${expr} === 'object' && ${expr} !== null ? ${expr} : {}`;
    default:
      return expr;
  }
}

// ── Main Command ──────────────────────────────────────────

/**
 * Run the schema evolution wizard for a collection.
 */
export async function evolveSchema(
  currentSchemas: Record<string, StoredSchema>,
  options: EvolveOptions = {}
): Promise<EvolveResult[]> {
  const cwd = options.cwd ?? process.cwd();
  const outputDir = options.outputDir ?? path.join(cwd, 'migrations');
  const results: EvolveResult[] = [];

  const previousSnapshot = getLatestSnapshot(cwd);
  const previousSchemas = previousSnapshot?.collections ?? {};

  const collections = options.collection ? [options.collection] : Object.keys(currentSchemas);

  for (const collection of collections) {
    const current = currentSchemas[collection];
    if (!current) continue;

    const previous = previousSchemas[collection];

    if (!previous) {
      results.push({
        collection,
        diff: {
          identical: true,
          changes: [],
          autoMigrateSafe: true,
          unsafeChanges: [],
          fromVersion: 0,
          toVersion: current.version,
        },
        migrationGenerated: false,
        migrationPath: null,
        dryRun: options.dryRun ?? false,
      });
      continue;
    }

    const diff = diffStoredSchemas(previous, current);

    if (diff.identical) {
      results.push({
        collection,
        diff,
        migrationGenerated: false,
        migrationPath: null,
        dryRun: options.dryRun ?? false,
      });
      continue;
    }

    // Check if we can auto-migrate
    if (!diff.autoMigrateSafe && !options.allowLossy) {
      results.push({
        collection,
        diff,
        migrationGenerated: false,
        migrationPath: null,
        dryRun: options.dryRun ?? false,
      });
      continue;
    }

    let migrationPath: string | null = null;
    if (!options.dryRun) {
      fs.mkdirSync(outputDir, { recursive: true });
      const filename = `${Date.now()}_${collection}_v${diff.fromVersion}_to_v${diff.toVersion}.ts`;
      migrationPath = path.join(outputDir, filename);
      const content = generateMigrationFile(collection, diff);
      fs.writeFileSync(migrationPath, content);
    }

    results.push({
      collection,
      diff,
      migrationGenerated: !options.dryRun,
      migrationPath,
      dryRun: options.dryRun ?? false,
    });
  }

  // Save new snapshot (unless dry run)
  if (!options.dryRun) {
    const maxVersion = Math.max(
      ...Object.values(currentSchemas).map((s) => s.version),
      previousSnapshot?.version ?? 0
    );
    saveSnapshot(cwd, {
      version: maxVersion,
      timestamp: Date.now(),
      collections: currentSchemas,
    });
  }

  return results;
}

/**
 * Format evolution results for terminal display.
 */
export function formatEvolveResults(results: EvolveResult[]): string {
  const lines: string[] = ['\n  Pocket Schema Evolution Wizard\n  ═══════════════════════════════'];

  for (const result of results) {
    lines.push(formatDiff(result.collection, result.diff));

    if (result.migrationGenerated && result.migrationPath) {
      lines.push(`  → Migration generated: ${result.migrationPath}`);
    } else if (result.dryRun && !result.diff.identical) {
      lines.push(`  → [DRY RUN] Would generate migration`);
    }
  }

  const changed = results.filter((r) => !r.diff.identical);
  const generated = results.filter((r) => r.migrationGenerated);
  lines.push(
    `\n  Summary: ${changed.length} collection(s) changed, ${generated.length} migration(s) generated\n`
  );

  return lines.join('\n');
}
