/**
 * Schema inspector for inferring, validating, and comparing collection schemas.
 *
 * @module @pocket/studio-pro
 *
 * @example
 * ```typescript
 * import { createSchemaInspector } from '@pocket/studio-pro';
 *
 * const inspector = createSchemaInspector({ maxHistoryEntries: 50 });
 * const schema = inspector.inspectCollection('users', [
 *   { _id: '1', name: 'Alice', age: 30 },
 *   { _id: '2', name: 'Bob', age: 25 },
 * ]);
 * console.log(schema.fields); // inferred fields
 * ```
 */

import type {
  CollectionSchema,
  SchemaField,
  SchemaValidationError,
  SchemaDiff,
  StudioConfig,
} from './types.js';

/**
 * Schema inspector API.
 */
export interface SchemaInspector {
  /** Infer a collection schema from sample documents. */
  inspectCollection(name: string, sampleDocs: Record<string, unknown>[]): CollectionSchema;
  /** Validate a schema and return any errors. */
  validateSchema(schema: CollectionSchema): SchemaValidationError[];
  /** Generate a TypeScript interface from a schema. */
  generateTypeScript(schema: CollectionSchema): string;
  /** Compare two schemas and return the differences. */
  diffSchemas(a: CollectionSchema, b: CollectionSchema): SchemaDiff[];
  /** Return all inspected schemas. */
  getAllSchemas(): CollectionSchema[];
}

function inferFieldType(value: unknown): string {
  if (value === null || value === undefined) return 'unknown';
  if (Array.isArray(value)) return 'array';
  if (value instanceof Date) return 'date';
  return typeof value;
}

function inferFields(docs: Record<string, unknown>[]): SchemaField[] {
  const fieldMap = new Map<string, { types: Set<string>; count: number }>();
  const totalDocs = docs.length;

  for (const doc of docs) {
    for (const [key, value] of Object.entries(doc)) {
      if (key === '_id') continue;
      const existing = fieldMap.get(key);
      const fieldType = inferFieldType(value);
      if (existing) {
        existing.types.add(fieldType);
        existing.count++;
      } else {
        fieldMap.set(key, { types: new Set([fieldType]), count: 1 });
      }
    }
  }

  const fields: SchemaField[] = [];
  for (const [name, info] of fieldMap) {
    const types = [...info.types].filter((t) => t !== 'unknown');
    const type = types.length === 1 ? types[0]! : types.length > 1 ? 'mixed' : 'unknown';
    fields.push({
      name,
      type,
      required: info.count === totalDocs,
      indexed: false,
    });
  }

  return fields;
}

function hasTimestamps(docs: Record<string, unknown>[]): boolean {
  const timestampFields = ['createdAt', 'updatedAt', 'created_at', 'updated_at'];
  return docs.some((doc) => timestampFields.some((f) => f in doc));
}

/**
 * Create a schema inspector instance.
 *
 * @example
 * ```typescript
 * const inspector = createSchemaInspector({ maxHistoryEntries: 50 });
 * const schema = inspector.inspectCollection('users', docs);
 * const errors = inspector.validateSchema(schema);
 * ```
 */
export function createSchemaInspector(
  config: Partial<StudioConfig> = {},
): SchemaInspector {
  const _config = { maxHistoryEntries: config.maxHistoryEntries ?? 100 };
  void _config;
  const schemas = new Map<string, CollectionSchema>();

  function inspectCollection(
    name: string,
    sampleDocs: Record<string, unknown>[],
  ): CollectionSchema {
    const fields = inferFields(sampleDocs);
    const indexedFields = fields.filter((f) => f.indexed).map((f) => f.name);
    const schema: CollectionSchema = {
      name,
      fields,
      primaryKey: '_id',
      indexes: indexedFields,
      timestamps: hasTimestamps(sampleDocs),
    };
    schemas.set(name, schema);
    return schema;
  }

  function validateSchema(schema: CollectionSchema): SchemaValidationError[] {
    const errors: SchemaValidationError[] = [];

    if (!schema.name) {
      errors.push({
        collection: schema.name,
        field: null,
        message: 'Collection name is required',
        severity: 'error',
      });
    }

    if (schema.fields.length === 0) {
      errors.push({
        collection: schema.name,
        field: null,
        message: 'Collection must have at least one field',
        severity: 'warning',
      });
    }

    const fieldNames = new Set<string>();
    for (const field of schema.fields) {
      if (fieldNames.has(field.name)) {
        errors.push({
          collection: schema.name,
          field: field.name,
          message: `Duplicate field name: ${field.name}`,
          severity: 'error',
        });
      }
      fieldNames.add(field.name);

      if (!field.name) {
        errors.push({
          collection: schema.name,
          field: field.name,
          message: 'Field name cannot be empty',
          severity: 'error',
        });
      }
    }

    return errors;
  }

  function generateTypeScript(schema: CollectionSchema): string {
    const interfaceName = schema.name.charAt(0).toUpperCase() + schema.name.slice(1);
    const lines: string[] = [`export interface ${interfaceName} {`];

    for (const field of schema.fields) {
      const tsType = mapToTsType(field.type);
      const optional = field.required ? '' : '?';
      lines.push(`  ${field.name}${optional}: ${tsType};`);
    }

    lines.push('}');
    return lines.join('\n');
  }

  function diffSchemas(a: CollectionSchema, b: CollectionSchema): SchemaDiff[] {
    const diffs: SchemaDiff[] = [];
    const aFields = new Map(a.fields.map((f) => [f.name, f]));
    const bFields = new Map(b.fields.map((f) => [f.name, f]));

    for (const [name] of bFields) {
      if (!aFields.has(name)) {
        diffs.push({ type: 'added', field: name, description: `Field '${name}' was added` });
      }
    }

    for (const [name] of aFields) {
      if (!bFields.has(name)) {
        diffs.push({ type: 'removed', field: name, description: `Field '${name}' was removed` });
      }
    }

    for (const [name, aField] of aFields) {
      const bField = bFields.get(name);
      if (bField && (aField.type !== bField.type || aField.required !== bField.required)) {
        const changes: string[] = [];
        if (aField.type !== bField.type) changes.push(`type: ${aField.type} → ${bField.type}`);
        if (aField.required !== bField.required) changes.push(`required: ${aField.required} → ${bField.required}`);
        diffs.push({ type: 'changed', field: name, description: changes.join(', ') });
      }
    }

    return diffs;
  }

  function getAllSchemas(): CollectionSchema[] {
    return [...schemas.values()];
  }

  return { inspectCollection, validateSchema, generateTypeScript, diffSchemas, getAllSchemas };
}

function mapToTsType(fieldType: string): string {
  switch (fieldType) {
    case 'string': return 'string';
    case 'number': return 'number';
    case 'boolean': return 'boolean';
    case 'date': return 'Date';
    case 'array': return 'unknown[]';
    case 'object': return 'Record<string, unknown>';
    default: return 'unknown';
  }
}
