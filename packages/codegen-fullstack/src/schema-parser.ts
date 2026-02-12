import type { CollectionDef, SchemaDefinition } from './types.js';

export interface SchemaParser {
  parse(input: string | object): SchemaDefinition;
  validate(schema: SchemaDefinition): { valid: boolean; errors: string[] };
  normalize(schema: SchemaDefinition): SchemaDefinition;
}

/**
 * Creates a schema parser that converts raw input into a validated SchemaDefinition.
 */
export function createSchemaParser(): SchemaParser {
  function parse(input: string | object): SchemaDefinition {
    let raw: unknown;

    if (typeof input === 'string') {
      const trimmed = input.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        raw = JSON.parse(trimmed);
      } else {
        raw = parseSimpleYaml(trimmed);
      }
    } else {
      raw = input;
    }

    return raw as SchemaDefinition;
  }

  function parseSimpleYaml(yaml: string): object {
    const result: Record<string, unknown> = {};
    const lines = yaml.split('\n');
    let currentKey = '';
    let collections: Record<string, unknown>[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const topMatch = /^(\w+):\s*(.+)?$/.exec(trimmed);
      if (topMatch) {
        const key = topMatch[1]!;
        const value = topMatch[2]?.trim();
        if (value) {
          result[key] = value;
        } else {
          currentKey = key;
          if (key === 'collections') {
            collections = [];
            result[key] = collections;
          }
        }
      } else if (trimmed.startsWith('- name:') && currentKey === 'collections') {
        const name = trimmed.replace('- name:', '').trim();
        collections.push({ name, fields: [] });
      }
    }

    return result;
  }

  function validate(schema: SchemaDefinition): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!schema.name || typeof schema.name !== 'string') {
      errors.push('Schema must have a name');
    }
    if (!schema.version || typeof schema.version !== 'string') {
      errors.push('Schema must have a version');
    }
    if (!Array.isArray(schema.collections) || schema.collections.length === 0) {
      errors.push('Schema must have at least one collection');
    }

    if (Array.isArray(schema.collections)) {
      const names = new Set<string>();
      for (const collection of schema.collections) {
        if (!collection.name) {
          errors.push('Each collection must have a name');
        } else if (names.has(collection.name)) {
          errors.push(`Duplicate collection name: ${collection.name}`);
        } else {
          names.add(collection.name);
        }

        if (!Array.isArray(collection.fields)) {
          errors.push(`Collection "${collection.name}" must have fields`);
        } else {
          const fieldNames = new Set<string>();
          for (const field of collection.fields) {
            if (!field.name) {
              errors.push(`Fields in "${collection.name}" must have a name`);
            } else if (fieldNames.has(field.name)) {
              errors.push(`Duplicate field "${field.name}" in collection "${collection.name}"`);
            } else {
              fieldNames.add(field.name);
            }

            const validTypes = ['string', 'number', 'boolean', 'date', 'object', 'array', 'enum'];
            if (!validTypes.includes(field.type)) {
              errors.push(`Invalid field type "${field.type}" in "${collection.name}.${field.name}"`);
            }
          }
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  function normalize(schema: SchemaDefinition): SchemaDefinition {
    const collections: CollectionDef[] = schema.collections.map((col) => ({
      name: col.name,
      primaryKey: col.primaryKey ?? '_id',
      timestamps: col.timestamps ?? true,
      softDelete: col.softDelete ?? false,
      fields: col.fields.map((field) => ({
        name: field.name,
        type: field.type,
        required: field.required ?? false,
        unique: field.unique ?? false,
        indexed: field.indexed ?? false,
        ...(field.default !== undefined ? { default: field.default } : {}),
        ...(field.relation ? { relation: field.relation } : {}),
      })),
    }));

    return {
      name: schema.name,
      version: schema.version,
      collections,
    };
  }

  return { parse, validate, normalize };
}
