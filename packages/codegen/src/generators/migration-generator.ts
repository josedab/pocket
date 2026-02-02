/**
 * @pocket/codegen - Migration Generator
 *
 * Generates migration files by diffing old and new Pocket schemas.
 *
 * @module @pocket/codegen
 */

import type { CollectionSchema, GeneratedFile, PocketSchema, SchemaField } from '../types.js';

/**
 * Describes a single change detected between two schemas.
 */
export interface SchemaChange {
  /** Type of change */
  type:
    | 'collection_added'
    | 'collection_removed'
    | 'field_added'
    | 'field_removed'
    | 'field_modified'
    | 'index_added'
    | 'index_removed';
  /** Collection name affected */
  collection: string;
  /** Field name affected (for field-level changes) */
  field?: string;
  /** Human-readable description of the change */
  description: string;
}

/**
 * Compare two SchemaField definitions and check if they are materially different.
 */
function fieldsAreDifferent(oldField: SchemaField, newField: SchemaField): boolean {
  if (oldField.type !== newField.type) return true;
  if (oldField.required !== newField.required) return true;
  if (oldField.unique !== newField.unique) return true;
  if (oldField.index !== newField.index) return true;
  if (JSON.stringify(oldField.validation) !== JSON.stringify(newField.validation)) return true;
  if (JSON.stringify(oldField.reference) !== JSON.stringify(newField.reference)) return true;
  if (JSON.stringify(oldField.default) !== JSON.stringify(newField.default)) return true;
  return false;
}

/**
 * Detect changes between two schemas.
 */
function detectChanges(oldSchema: PocketSchema, newSchema: PocketSchema): SchemaChange[] {
  const changes: SchemaChange[] = [];

  const oldCollections = new Map<string, CollectionSchema>();
  for (const col of oldSchema.collections) {
    oldCollections.set(col.name, col);
  }

  const newCollections = new Map<string, CollectionSchema>();
  for (const col of newSchema.collections) {
    newCollections.set(col.name, col);
  }

  // Detect added collections
  for (const [name, newCol] of newCollections) {
    if (!oldCollections.has(name)) {
      changes.push({
        type: 'collection_added',
        collection: name,
        description: `Add collection "${name}" with ${Object.keys(newCol.fields).length} field(s)`,
      });
    }
  }

  // Detect removed collections
  for (const [name] of oldCollections) {
    if (!newCollections.has(name)) {
      changes.push({
        type: 'collection_removed',
        collection: name,
        description: `Remove collection "${name}"`,
      });
    }
  }

  // Detect field changes in existing collections
  for (const [name, newCol] of newCollections) {
    const oldCol = oldCollections.get(name);
    if (!oldCol) continue;

    // Detect added fields
    for (const [fieldName, newField] of Object.entries(newCol.fields)) {
      const oldField = oldCol.fields[fieldName];
      if (!oldField) {
        changes.push({
          type: 'field_added',
          collection: name,
          field: fieldName,
          description: `Add field "${fieldName}" (${newField.type}) to "${name}"`,
        });
      } else if (fieldsAreDifferent(oldField, newField)) {
        changes.push({
          type: 'field_modified',
          collection: name,
          field: fieldName,
          description: `Modify field "${fieldName}" in "${name}" (${oldField.type} -> ${newField.type})`,
        });
      }
    }

    // Detect removed fields
    for (const fieldName of Object.keys(oldCol.fields)) {
      if (!newCol.fields[fieldName]) {
        changes.push({
          type: 'field_removed',
          collection: name,
          field: fieldName,
          description: `Remove field "${fieldName}" from "${name}"`,
        });
      }
    }

    // Detect index changes
    const oldIndexes = (oldCol.indexes ?? []).map((idx) => JSON.stringify(idx));
    const newIndexes = (newCol.indexes ?? []).map((idx) => JSON.stringify(idx));

    for (const idx of newIndexes) {
      if (!oldIndexes.includes(idx)) {
        const parsed = JSON.parse(idx) as { fields: string[]; unique?: boolean };
        changes.push({
          type: 'index_added',
          collection: name,
          description: `Add index on [${parsed.fields.join(', ')}]${parsed.unique ? ' (unique)' : ''} to "${name}"`,
        });
      }
    }

    for (const idx of oldIndexes) {
      if (!newIndexes.includes(idx)) {
        const parsed = JSON.parse(idx) as { fields: string[]; unique?: boolean };
        changes.push({
          type: 'index_removed',
          collection: name,
          description: `Remove index on [${parsed.fields.join(', ')}] from "${name}"`,
        });
      }
    }
  }

  return changes;
}

/**
 * Generate the migration code body for the up() function.
 */
function generateUpBody(changes: SchemaChange[]): string {
  const lines: string[] = [];

  for (const change of changes) {
    lines.push(`    // ${change.description}`);

    switch (change.type) {
      case 'collection_added':
        lines.push(`    await db.createCollection('${change.collection}');`);
        break;
      case 'collection_removed':
        lines.push(`    await db.dropCollection('${change.collection}');`);
        break;
      case 'field_added':
        lines.push(
          `    await db.collection('${change.collection}').addField('${change.field}');`
        );
        break;
      case 'field_removed':
        lines.push(
          `    await db.collection('${change.collection}').removeField('${change.field}');`
        );
        break;
      case 'field_modified':
        lines.push(
          `    await db.collection('${change.collection}').migrateField('${change.field}');`
        );
        break;
      case 'index_added':
        lines.push(
          `    await db.collection('${change.collection}').createIndex(/* see description above */);`
        );
        break;
      case 'index_removed':
        lines.push(
          `    await db.collection('${change.collection}').dropIndex(/* see description above */);`
        );
        break;
    }

    lines.push(``);
  }

  return lines.join('\n');
}

/**
 * Generate the migration code body for the down() function (reverse of up).
 */
function generateDownBody(changes: SchemaChange[]): string {
  const lines: string[] = [];

  // Reverse the changes for rollback
  const reversed = [...changes].reverse();

  for (const change of reversed) {
    lines.push(`    // Undo: ${change.description}`);

    switch (change.type) {
      case 'collection_added':
        lines.push(`    await db.dropCollection('${change.collection}');`);
        break;
      case 'collection_removed':
        lines.push(`    await db.createCollection('${change.collection}');`);
        break;
      case 'field_added':
        lines.push(
          `    await db.collection('${change.collection}').removeField('${change.field}');`
        );
        break;
      case 'field_removed':
        lines.push(
          `    await db.collection('${change.collection}').addField('${change.field}');`
        );
        break;
      case 'field_modified':
        lines.push(
          `    await db.collection('${change.collection}').migrateField('${change.field}');`
        );
        break;
      case 'index_added':
        lines.push(
          `    await db.collection('${change.collection}').dropIndex(/* see description above */);`
        );
        break;
      case 'index_removed':
        lines.push(
          `    await db.collection('${change.collection}').createIndex(/* see description above */);`
        );
        break;
    }

    lines.push(``);
  }

  return lines.join('\n');
}

/**
 * MigrationGenerator compares old and new Pocket schemas and produces
 * migration files with up() and down() functions.
 */
export class MigrationGenerator {
  /**
   * Generate a migration file by diffing two schemas.
   *
   * Detects:
   * - Added/removed collections
   * - Added/removed/modified fields
   * - Added/removed indexes
   *
   * @param oldSchema - The previous schema version
   * @param newSchema - The new schema version
   * @returns A generated migration file, or null if no changes detected
   */
  generateMigration(oldSchema: PocketSchema, newSchema: PocketSchema): GeneratedFile | null {
    const changes = detectChanges(oldSchema, newSchema);

    if (changes.length === 0) {
      return null;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `${timestamp}-migration`;

    const upBody = generateUpBody(changes);
    const downBody = generateDownBody(changes);

    const content = [
      `/**`,
      ` * Auto-generated migration`,
      ` *`,
      ` * Schema change: ${oldSchema.version} -> ${newSchema.version}`,
      ` *`,
      ` * Changes:`,
      ...changes.map((c) => ` *   - ${c.description}`),
      ` *`,
      ` * DO NOT EDIT - This file is auto-generated by @pocket/codegen`,
      ` */`,
      ``,
      `import type { PocketDatabase } from '@pocket/core';`,
      ``,
      `export const version = '${newSchema.version}';`,
      ``,
      `/**`,
      ` * Apply migration forward`,
      ` */`,
      `export async function up(db: PocketDatabase): Promise<void> {`,
      upBody,
      `}`,
      ``,
      `/**`,
      ` * Rollback migration`,
      ` */`,
      `export async function down(db: PocketDatabase): Promise<void> {`,
      downBody,
      `}`,
      ``,
    ].join('\n');

    return {
      path: `migrations/${fileName}.ts`,
      content,
      type: 'migration',
    };
  }

  /**
   * Detect changes between two schemas without generating a file.
   * Useful for previewing what a migration would contain.
   *
   * @param oldSchema - The previous schema version
   * @param newSchema - The new schema version
   * @returns Array of detected changes
   */
  detectChanges(oldSchema: PocketSchema, newSchema: PocketSchema): SchemaChange[] {
    return detectChanges(oldSchema, newSchema);
  }
}
