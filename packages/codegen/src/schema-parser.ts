/**
 * @pocket/codegen - Schema Parser
 *
 * Parses, validates, and resolves Pocket schema definitions.
 *
 * @module @pocket/codegen
 */

import type { CollectionSchema, PocketSchema, SchemaField, SchemaFieldType } from './types.js';

/**
 * Validation error returned by the schema parser.
 */
export interface SchemaValidationError {
  /** Dot-separated path to the problematic field (e.g. "collections[0].fields.email") */
  path: string;
  /** Human-readable error message */
  message: string;
}

/**
 * Result of schema validation.
 */
export interface SchemaValidationResult {
  valid: boolean;
  errors: SchemaValidationError[];
}

/** Valid field types for validation checks */
const VALID_FIELD_TYPES: SchemaFieldType[] = [
  'string',
  'number',
  'boolean',
  'date',
  'array',
  'object',
  'reference',
];

/**
 * SchemaParser handles parsing, validation, and reference resolution
 * for Pocket schema definitions.
 */
export class SchemaParser {
  /**
   * Parse a schema from a JSON string or accept a pre-parsed PocketSchema object.
   *
   * @param input - JSON string or PocketSchema object
   * @returns Parsed PocketSchema
   * @throws Error if the input string is not valid JSON
   */
  parseSchema(input: string | PocketSchema): PocketSchema {
    if (typeof input === 'string') {
      try {
        const parsed = JSON.parse(input) as PocketSchema;
        return parsed;
      } catch {
        throw new Error('Invalid schema: input is not valid JSON');
      }
    }
    return input;
  }

  /**
   * Validate a schema definition for structural correctness.
   *
   * Checks:
   * - Required top-level fields (version, collections)
   * - Collection names are non-empty
   * - Field types are valid SchemaFieldType values
   * - Array fields have `items` defined
   * - Object fields have `properties` defined
   * - Reference fields have `reference.collection` defined
   * - Referenced collections exist in the schema
   * - Index fields reference existing field names
   *
   * @param schema - The schema to validate
   * @returns Validation result with any errors found
   */
  validate(schema: PocketSchema): SchemaValidationResult {
    const errors: SchemaValidationError[] = [];

    // Top-level checks
    if (!schema.version) {
      errors.push({ path: 'version', message: 'Schema version is required' });
    }

    if (!schema.collections || !Array.isArray(schema.collections)) {
      errors.push({ path: 'collections', message: 'Collections array is required' });
      return { valid: false, errors };
    }

    if (schema.collections.length === 0) {
      errors.push({ path: 'collections', message: 'At least one collection is required' });
    }

    // Check for duplicate collection names
    const collectionNames = new Set<string>();

    for (let i = 0; i < schema.collections.length; i++) {
      const collection = schema.collections[i]!;
      const collectionPath = `collections[${i}]`;

      if (!collection.name || collection.name.trim() === '') {
        errors.push({ path: `${collectionPath}.name`, message: 'Collection name is required' });
      } else if (collectionNames.has(collection.name)) {
        errors.push({
          path: `${collectionPath}.name`,
          message: `Duplicate collection name: "${collection.name}"`,
        });
      } else {
        collectionNames.add(collection.name);
      }

      if (!collection.fields || typeof collection.fields !== 'object') {
        errors.push({ path: `${collectionPath}.fields`, message: 'Collection fields are required' });
        continue;
      }

      // Validate each field
      for (const [fieldName, field] of Object.entries(collection.fields)) {
        const fieldPath = `${collectionPath}.fields.${fieldName}`;
        this.validateField(field, fieldPath, errors);
      }

      // Validate indexes reference existing fields
      if (collection.indexes) {
        for (let j = 0; j < collection.indexes.length; j++) {
          const index = collection.indexes[j]!;
          const indexPath = `${collectionPath}.indexes[${j}]`;

          if (!index.fields || index.fields.length === 0) {
            errors.push({ path: `${indexPath}.fields`, message: 'Index must have at least one field' });
          } else {
            for (const indexField of index.fields) {
              if (!collection.fields[indexField]) {
                errors.push({
                  path: `${indexPath}.fields`,
                  message: `Index references unknown field: "${indexField}"`,
                });
              }
            }
          }
        }
      }
    }

    // Validate references point to existing collections
    for (let i = 0; i < schema.collections.length; i++) {
      const collection = schema.collections[i]!;
      const collectionPath = `collections[${i}]`;

      if (!collection.fields) continue;

      for (const [fieldName, field] of Object.entries(collection.fields)) {
        if (field.type === 'reference' && field.reference) {
          if (!collectionNames.has(field.reference.collection)) {
            errors.push({
              path: `${collectionPath}.fields.${fieldName}.reference.collection`,
              message: `Referenced collection "${field.reference.collection}" does not exist`,
            });
          }
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Resolve collection references in the schema by verifying that
   * all reference fields point to valid collections and fields.
   *
   * Returns a map from "collectionName.fieldName" to the target CollectionSchema.
   *
   * @param schema - A validated schema
   * @returns Map of reference paths to their target collection schemas
   */
  resolveReferences(schema: PocketSchema): Map<string, CollectionSchema> {
    const collectionMap = new Map<string, CollectionSchema>();
    for (const collection of schema.collections) {
      collectionMap.set(collection.name, collection);
    }

    const resolved = new Map<string, CollectionSchema>();

    for (const collection of schema.collections) {
      for (const [fieldName, field] of Object.entries(collection.fields)) {
        if (field.type === 'reference' && field.reference) {
          const target = collectionMap.get(field.reference.collection);
          if (target) {
            resolved.set(`${collection.name}.${fieldName}`, target);
          }
        }
      }
    }

    return resolved;
  }

  /**
   * Validate a single field definition recursively.
   */
  private validateField(field: SchemaField, path: string, errors: SchemaValidationError[]): void {
    if (!field.type) {
      errors.push({ path: `${path}.type`, message: 'Field type is required' });
      return;
    }

    if (!VALID_FIELD_TYPES.includes(field.type)) {
      errors.push({
        path: `${path}.type`,
        message: `Invalid field type: "${field.type}". Must be one of: ${VALID_FIELD_TYPES.join(', ')}`,
      });
      return;
    }

    // Array fields must have items
    if (field.type === 'array' && !field.items) {
      errors.push({ path: `${path}.items`, message: 'Array fields must define "items"' });
    }

    // Object fields must have properties
    if (field.type === 'object' && !field.properties) {
      errors.push({ path: `${path}.properties`, message: 'Object fields must define "properties"' });
    }

    // Reference fields must have reference
    if (field.type === 'reference' && !field.reference) {
      errors.push({ path: `${path}.reference`, message: 'Reference fields must define "reference"' });
    } else if (field.type === 'reference' && field.reference && !field.reference.collection) {
      errors.push({
        path: `${path}.reference.collection`,
        message: 'Reference must specify a target collection',
      });
    }

    // Recurse into items for array type
    if (field.type === 'array' && field.items) {
      this.validateField(field.items, `${path}.items`, errors);
    }

    // Recurse into properties for object type
    if (field.type === 'object' && field.properties) {
      for (const [propName, propField] of Object.entries(field.properties)) {
        this.validateField(propField, `${path}.properties.${propName}`, errors);
      }
    }

    // Validate validation constraints
    if (field.validation) {
      if (field.validation.min !== undefined && field.validation.max !== undefined) {
        if (field.validation.min > field.validation.max) {
          errors.push({
            path: `${path}.validation`,
            message: 'Validation "min" cannot be greater than "max"',
          });
        }
      }
    }
  }
}

/**
 * Factory function to create a new SchemaParser instance.
 */
export function createSchemaParser(): SchemaParser {
  return new SchemaParser();
}
