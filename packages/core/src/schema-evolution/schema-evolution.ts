import type { FieldDefinition, FieldType, SchemaDefinition } from '../schema/schema.js';

/**
 * Types of changes detected between two schema versions.
 */
export type SchemaChangeType =
  | 'field_added'
  | 'field_removed'
  | 'field_type_changed'
  | 'field_required_changed'
  | 'field_default_changed'
  | 'field_constraint_changed'
  | 'field_nested_changed';

/**
 * A single detected change between two schema versions.
 */
export interface SchemaChange {
  type: SchemaChangeType;
  path: string;
  previous: FieldDefinition | null;
  current: FieldDefinition | null;
  safe: boolean;
  description: string;
}

/**
 * Result of diffing two schemas.
 */
export interface SchemaDiffResult {
  identical: boolean;
  changes: SchemaChange[];
  autoMigrateSafe: boolean;
  unsafeChanges: SchemaChange[];
  fromVersion: number;
  toVersion: number;
}

/**
 * Configuration for the schema evolution engine.
 */
export interface SchemaEvolutionConfig {
  allowLossyCoercions?: boolean;
  fieldTransforms?: Record<string, (value: unknown) => unknown>;
  lazy?: boolean;
  versionField?: string;
}

/**
 * Result of evolving a single document.
 */
export interface DocumentEvolutionResult {
  document: Record<string, unknown>;
  evolved: boolean;
  toVersion: number;
  appliedChanges: SchemaChange[];
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
  'date→string': (v) => (v instanceof Date ? v.toISOString() : String(v)),
  'date→number': (v) => (v instanceof Date ? v.getTime() : 0),
};

function isLosslessCoercion(from: FieldType, to: FieldType): boolean {
  const lossless = new Set(['number→string', 'boolean→string', 'boolean→number']);
  return lossless.has(`${from}→${to}`);
}

/**
 * Diff two schema definitions to detect all changes.
 *
 * @example
 * ```typescript
 * const diff = diffSchemas(oldSchema, newSchema);
 * if (!diff.identical && diff.autoMigrateSafe) {
 *   await evolveDocuments(collection, diff);
 * }
 * ```
 */
export function diffSchemas(from: SchemaDefinition, to: SchemaDefinition): SchemaDiffResult {
  const changes: SchemaChange[] = [];
  diffProperties('', from.properties, to.properties, changes);

  const unsafeChanges = changes.filter((c) => !c.safe);

  return {
    identical: changes.length === 0,
    changes,
    autoMigrateSafe: unsafeChanges.length === 0,
    unsafeChanges,
    fromVersion: from.version ?? 1,
    toVersion: to.version ?? 1,
  };
}

function diffProperties(
  basePath: string,
  fromProps: Record<string, FieldDefinition>,
  toProps: Record<string, FieldDefinition>,
  changes: SchemaChange[]
): void {
  const fromKeys = new Set(Object.keys(fromProps));
  const toKeys = new Set(Object.keys(toProps));

  for (const key of toKeys) {
    if (!fromKeys.has(key)) {
      const fieldDef = toProps[key]!;
      changes.push({
        type: 'field_added',
        path: basePath ? `${basePath}.${key}` : key,
        previous: null,
        current: fieldDef,
        safe: !fieldDef.required || fieldDef.default !== undefined,
        description:
          fieldDef.required && fieldDef.default === undefined
            ? `Required field "${key}" added without default`
            : `Field "${key}" added${fieldDef.default !== undefined ? ` with default` : ''}`,
      });
    }
  }

  for (const key of fromKeys) {
    if (!toKeys.has(key)) {
      changes.push({
        type: 'field_removed',
        path: basePath ? `${basePath}.${key}` : key,
        previous: fromProps[key]!,
        current: null,
        safe: true,
        description: `Field "${key}" removed`,
      });
    }
  }

  for (const key of fromKeys) {
    if (!toKeys.has(key)) continue;
    const fromField = fromProps[key]!;
    const toField = toProps[key]!;
    const path = basePath ? `${basePath}.${key}` : key;

    const fromType = normalizeType(fromField.type);
    const toType = normalizeType(toField.type);
    if (fromType !== toType) {
      const fromPrimary = Array.isArray(fromField.type) ? fromField.type[0]! : fromField.type;
      const toPrimary = Array.isArray(toField.type) ? toField.type[0]! : toField.type;

      changes.push({
        type: 'field_type_changed',
        path,
        previous: fromField,
        current: toField,
        safe: isLosslessCoercion(fromPrimary, toPrimary),
        description: `Field "${key}" type changed from ${fromType} to ${toType}`,
      });
    }

    if (Boolean(fromField.required) !== Boolean(toField.required)) {
      const becameRequired = Boolean(toField.required);
      changes.push({
        type: 'field_required_changed',
        path,
        previous: fromField,
        current: toField,
        safe: !becameRequired || toField.default !== undefined,
        description: becameRequired
          ? `Field "${key}" became required`
          : `Field "${key}" became optional`,
      });
    }

    if (JSON.stringify(fromField.default) !== JSON.stringify(toField.default)) {
      changes.push({
        type: 'field_default_changed',
        path,
        previous: fromField,
        current: toField,
        safe: true,
        description: `Field "${key}" default changed`,
      });
    }

    if (
      fromField.min !== toField.min ||
      fromField.max !== toField.max ||
      String(fromField.pattern) !== String(toField.pattern) ||
      JSON.stringify(fromField.enum) !== JSON.stringify(toField.enum)
    ) {
      changes.push({
        type: 'field_constraint_changed',
        path,
        previous: fromField,
        current: toField,
        safe: true,
        description: `Field "${key}" constraints changed`,
      });
    }

    if (fromField.properties && toField.properties) {
      diffProperties(path, fromField.properties, toField.properties, changes);
    }
  }
}

function normalizeType(type: FieldType | FieldType[]): string {
  if (Array.isArray(type)) return [...type].sort().join('|');
  return type;
}

/**
 * Evolve a single document from one schema version to another.
 */
export function evolveDocument(
  doc: Record<string, unknown>,
  diff: SchemaDiffResult,
  config: SchemaEvolutionConfig = {}
): DocumentEvolutionResult {
  if (diff.identical) {
    return { document: doc, evolved: false, toVersion: diff.toVersion, appliedChanges: [] };
  }

  const versionField = config.versionField ?? '_schemaVersion';
  const result = { ...doc };
  const appliedChanges: SchemaChange[] = [];

  for (const change of diff.changes) {
    if (!change.safe && !config.allowLossyCoercions) continue;

    const applied = applyChange(result, change, config);
    if (applied) {
      appliedChanges.push(change);
    }
  }

  if (appliedChanges.length > 0) {
    result[versionField] = diff.toVersion;
  }

  return {
    document: result,
    evolved: appliedChanges.length > 0,
    toVersion: diff.toVersion,
    appliedChanges,
  };
}

function applyChange(
  doc: Record<string, unknown>,
  change: SchemaChange,
  config: SchemaEvolutionConfig
): boolean {
  const parts = change.path.split('.');

  switch (change.type) {
    case 'field_added': {
      if (getNestedValue(doc, parts) !== undefined) return false;
      if (change.current?.default !== undefined) {
        const defaultVal =
          typeof change.current.default === 'function'
            ? (change.current.default as () => unknown)()
            : structuredClone(change.current.default);
        setNestedValue(doc, parts, defaultVal);
        return true;
      }
      return false;
    }

    case 'field_removed': {
      if (getNestedValue(doc, parts) === undefined) return false;
      deleteNestedValue(doc, parts);
      return true;
    }

    case 'field_type_changed': {
      const currentValue = getNestedValue(doc, parts);
      if (currentValue === undefined || currentValue === null) return false;

      const customTransform = config.fieldTransforms?.[change.path];
      if (customTransform) {
        setNestedValue(doc, parts, customTransform(currentValue));
        return true;
      }

      const fromType = Array.isArray(change.previous!.type)
        ? change.previous!.type[0]!
        : change.previous!.type;
      const toType = Array.isArray(change.current!.type)
        ? change.current!.type[0]!
        : change.current!.type;
      const coercionKey = `${fromType}→${toType}`;
      const coercion = SAFE_COERCIONS[coercionKey];

      if (coercion) {
        setNestedValue(doc, parts, coercion(currentValue));
        return true;
      }
      return false;
    }

    case 'field_required_changed': {
      if (change.current?.required && getNestedValue(doc, parts) === undefined) {
        if (change.current.default !== undefined) {
          const defaultVal =
            typeof change.current.default === 'function'
              ? (change.current.default as () => unknown)()
              : structuredClone(change.current.default);
          setNestedValue(doc, parts, defaultVal);
          return true;
        }
      }
      return false;
    }

    default:
      return false;
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
 * Generate migration functions from a schema diff, compatible with MigrationManager.
 *
 * @example
 * ```typescript
 * const diff = diffSchemas(v1Schema, v2Schema);
 * const { up, down } = generateMigrationFromDiff(diff);
 * migrationManager.addMigration('users', { version: 2, up, down });
 * ```
 */
export function generateMigrationFromDiff(
  diff: SchemaDiffResult,
  config: SchemaEvolutionConfig = {}
): {
  up: (doc: Record<string, unknown>) => Record<string, unknown>;
  down: (doc: Record<string, unknown>) => Record<string, unknown>;
} {
  const up = (doc: Record<string, unknown>): Record<string, unknown> => {
    return evolveDocument(doc, diff, config).document;
  };

  const reverseDiff: SchemaDiffResult = {
    ...diff,
    fromVersion: diff.toVersion,
    toVersion: diff.fromVersion,
    changes: diff.changes.map(reverseChange),
  };

  const down = (doc: Record<string, unknown>): Record<string, unknown> => {
    return evolveDocument(doc, reverseDiff, config).document;
  };

  return { up, down };
}

function reverseChange(change: SchemaChange): SchemaChange {
  switch (change.type) {
    case 'field_added':
      return { ...change, type: 'field_removed', previous: change.current, current: null };
    case 'field_removed':
      return { ...change, type: 'field_added', previous: null, current: change.previous };
    case 'field_type_changed':
      return { ...change, previous: change.current, current: change.previous };
    default:
      return { ...change, previous: change.current, current: change.previous };
  }
}
