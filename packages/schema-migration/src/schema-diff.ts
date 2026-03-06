/**
 * @pocket/schema-migration — Schema diff engine.
 *
 * Compares two database schemas and produces a list of changes,
 * which can be used to auto-generate migration steps.
 *
 * @module @pocket/schema-migration
 */

import type {
  CollectionSchema,
  DatabaseSchema,
  FieldDefinition,
  MigrationStep,
  SchemaDiff,
  SchemaDiffChange,
} from './types.js';

/**
 * Compare two database schemas and return the differences.
 */
export function diffSchemas(from: DatabaseSchema, to: DatabaseSchema): SchemaDiff {
  const changes: SchemaDiffChange[] = [];
  let isBreaking = false;

  const fromMap = new Map(from.collections.map((c) => [c.name, c]));
  const toMap = new Map(to.collections.map((c) => [c.name, c]));

  // Removed collections
  for (const [name] of fromMap) {
    if (!toMap.has(name)) {
      changes.push({ type: 'collection_removed', collection: name });
      isBreaking = true;
    }
  }

  // Added collections
  for (const [name, schema] of toMap) {
    if (!fromMap.has(name)) {
      changes.push({ type: 'collection_added', collection: schema });
    }
  }

  // Modified collections
  for (const [name, fromCol] of fromMap) {
    const toCol = toMap.get(name);
    if (!toCol) continue;

    const fieldChanges = diffFields(name, fromCol, toCol);
    const indexChanges = diffIndexes(name, fromCol, toCol);

    for (const change of fieldChanges) {
      changes.push(change);
      if (change.type === 'field_removed') isBreaking = true;
    }
    for (const change of indexChanges) {
      changes.push(change);
    }
  }

  const summary = changes.length === 0
    ? 'No changes detected'
    : `${changes.length} change(s): ${changes.map((c) => c.type).join(', ')}`;

  return { changes, isBreaking, summary };
}

function diffFields(
  collection: string,
  from: CollectionSchema,
  to: CollectionSchema,
): SchemaDiffChange[] {
  const changes: SchemaDiffChange[] = [];
  const fromFields = new Map(from.fields.map((f) => [f.name, f]));
  const toFields = new Map(to.fields.map((f) => [f.name, f]));

  for (const [name] of fromFields) {
    if (!toFields.has(name)) {
      changes.push({ type: 'field_removed', collection, fieldName: name });
    }
  }

  for (const [name, field] of toFields) {
    if (!fromFields.has(name)) {
      changes.push({ type: 'field_added', collection, field });
    }
  }

  for (const [name, fromField] of fromFields) {
    const toField = toFields.get(name);
    if (!toField) continue;

    const fieldChanges: Partial<FieldDefinition> = {};
    if (fromField.type !== toField.type) fieldChanges.type = toField.type;
    if (fromField.required !== toField.required) fieldChanges.required = toField.required;
    if (fromField.indexed !== toField.indexed) fieldChanges.indexed = toField.indexed;
    if (fromField.unique !== toField.unique) fieldChanges.unique = toField.unique;

    if (Object.keys(fieldChanges).length > 0) {
      changes.push({ type: 'field_modified', collection, fieldName: name, changes: fieldChanges });
    }
  }

  return changes;
}

function diffIndexes(
  collection: string,
  from: CollectionSchema,
  to: CollectionSchema,
): SchemaDiffChange[] {
  const changes: SchemaDiffChange[] = [];
  const fromIndexes = new Map((from.indexes ?? []).map((i) => [i.name, i]));
  const toIndexes = new Map((to.indexes ?? []).map((i) => [i.name, i]));

  for (const [name] of fromIndexes) {
    if (!toIndexes.has(name)) {
      changes.push({ type: 'index_removed', collection, indexName: name });
    }
  }

  for (const [name, index] of toIndexes) {
    if (!fromIndexes.has(name)) {
      changes.push({ type: 'index_added', collection, index });
    }
  }

  return changes;
}

/**
 * Generate migration steps from a schema diff.
 */
export function generateMigrationSteps(diff: SchemaDiff): { up: MigrationStep[]; down: MigrationStep[] } {
  const up: MigrationStep[] = [];
  const down: MigrationStep[] = [];

  for (const change of diff.changes) {
    switch (change.type) {
      case 'collection_added':
        up.push({ type: 'createCollection', collection: change.collection.name, schema: change.collection });
        down.push({ type: 'dropCollection', collection: change.collection.name });
        break;
      case 'collection_removed':
        up.push({ type: 'dropCollection', collection: change.collection });
        // Note: cannot fully reverse without original schema
        break;
      case 'collection_renamed':
        up.push({ type: 'renameCollection', from: change.from, to: change.to });
        down.push({ type: 'renameCollection', from: change.to, to: change.from });
        break;
      case 'field_added':
        up.push({ type: 'addField', collection: change.collection, field: change.field });
        down.push({ type: 'removeField', collection: change.collection, fieldName: change.field.name });
        break;
      case 'field_removed':
        up.push({ type: 'removeField', collection: change.collection, fieldName: change.fieldName });
        break;
      case 'field_modified':
        up.push({ type: 'modifyField', collection: change.collection, fieldName: change.fieldName, changes: change.changes });
        break;
      case 'index_added':
        up.push({ type: 'addIndex', collection: change.collection, index: change.index });
        down.push({ type: 'removeIndex', collection: change.collection, indexName: change.index.name });
        break;
      case 'index_removed':
        up.push({ type: 'removeIndex', collection: change.collection, indexName: change.indexName });
        break;
    }
  }

  return { up, down };
}
