import type { Document } from '../types/document.js';
import type { IndexDefinition } from '../types/storage.js';

/**
 * Supported field types for schema validation.
 *
 * @see {@link FieldDefinition}
 */
export type FieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'array'
  | 'object'
  | 'date'
  | 'null'
  | 'any';

/**
 * Definition for a single field in a schema.
 *
 * Supports type validation, constraints, defaults, and nested schemas.
 *
 * @example String field with constraints
 * ```typescript
 * const emailField: FieldDefinition = {
 *   type: 'string',
 *   required: true,
 *   pattern: '^[^@]+@[^@]+\\.[^@]+$'
 * };
 * ```
 *
 * @example Number with range
 * ```typescript
 * const ageField: FieldDefinition = {
 *   type: 'number',
 *   min: 0,
 *   max: 150
 * };
 * ```
 *
 * @example Field with default value
 * ```typescript
 * const roleField: FieldDefinition = {
 *   type: 'string',
 *   default: 'user',
 *   enum: ['user', 'admin', 'moderator']
 * };
 * ```
 *
 * @example Nested object
 * ```typescript
 * const addressField: FieldDefinition = {
 *   type: 'object',
 *   properties: {
 *     street: { type: 'string', required: true },
 *     city: { type: 'string', required: true },
 *     zip: { type: 'string', pattern: '^\\d{5}$' }
 *   }
 * };
 * ```
 */
export interface FieldDefinition {
  /**
   * The field type(s). Can be a single type or array for union types.
   * @example 'string'
   * @example ['string', 'null']
   */
  type: FieldType | FieldType[];

  /** Whether the field must be present (not undefined) */
  required?: boolean;

  /**
   * Default value applied when field is missing.
   * Can be a value or a function that returns a value.
   */
  default?: unknown;

  /** Minimum value (numbers) or length (strings/arrays) */
  min?: number;

  /** Maximum value (numbers) or length (strings/arrays) */
  max?: number;

  /** Regex pattern for string validation */
  pattern?: string | RegExp;

  /** Allowed values (for enums) */
  enum?: unknown[];

  /** Nested schema for object fields */
  properties?: SchemaDefinition['properties'];

  /** Schema for array elements */
  items?: FieldDefinition;
}

/**
 * Complete schema definition for a collection.
 *
 * @example
 * ```typescript
 * const userSchema: SchemaDefinition = {
 *   version: 1,
 *   properties: {
 *     name: { type: 'string', required: true, min: 1 },
 *     email: { type: 'string', required: true, pattern: '^[^@]+@[^@]+$' },
 *     age: { type: 'number', min: 0 },
 *     role: { type: 'string', default: 'user', enum: ['user', 'admin'] },
 *     tags: { type: 'array', items: { type: 'string' } }
 *   },
 *   additionalProperties: false
 * };
 * ```
 */
export interface SchemaDefinition {
  /** Schema version for migrations */
  version?: number;

  /** Field definitions mapping field name to definition */
  properties: Record<string, FieldDefinition>;

  /** Whether to allow fields not defined in properties. @default true */
  additionalProperties?: boolean;

  /** List of required field names (alternative to setting required in each field) */
  required?: string[];
}

/**
 * Configuration options for a collection.
 *
 * @typeParam T - The document type for this collection
 *
 * @example
 * ```typescript
 * const usersConfig: CollectionConfig<User> = {
 *   name: 'users',
 *   schema: userSchema,
 *   indexes: [
 *     { name: 'email-idx', fields: ['email'], unique: true }
 *   ],
 *   sync: true,
 *   conflictStrategy: 'last-write-wins'
 * };
 * ```
 */
export interface CollectionConfig<T extends Document = Document> {
  /** Collection name (must be unique within database) */
  name: string;

  /** Schema for validation and defaults */
  schema?: SchemaDefinition;

  /** Index definitions for query optimization */
  indexes?: IndexDefinition[];

  /** Default sort field for queries */
  defaultSort?: keyof T & string;

  /** Time-to-live in milliseconds for auto-expiring documents */
  ttl?: number;

  /** Enable sync for this collection */
  sync?: boolean;

  /**
   * Strategy for resolving conflicts during sync.
   * - 'server-wins': Server version always takes precedence
   * - 'client-wins': Client version always takes precedence
   * - 'last-write-wins': Most recent update wins (by timestamp)
   * - 'merge': Deep merge conflicting changes
   */
  conflictStrategy?: 'server-wins' | 'client-wins' | 'last-write-wins' | 'merge';
}

/**
 * Database-level configuration.
 *
 * @see {@link DatabaseOptions}
 */
export interface DatabaseConfig {
  /** Database name (used for storage isolation) */
  name: string;

  /** Database schema version for migrations */
  version?: number;

  /** Pre-configured collection definitions */
  collections?: CollectionConfig[];
}

/**
 * Runtime schema validator for type checking and default value application.
 *
 * Schema provides:
 * - Runtime type validation for documents
 * - Default value application for missing fields
 * - Detailed validation error messages
 *
 * @typeParam T - The document type this schema validates
 *
 * @example
 * ```typescript
 * const schema = new Schema<User>({
 *   properties: {
 *     name: { type: 'string', required: true },
 *     role: { type: 'string', default: 'user' }
 *   }
 * });
 *
 * // Apply defaults
 * const withDefaults = schema.applyDefaults({ name: 'Alice' });
 * // { name: 'Alice', role: 'user' }
 *
 * // Validate
 * const result = schema.validate({ name: '' });
 * if (!result.valid) {
 *   console.log(result.errors);
 * }
 * ```
 *
 * @see {@link SchemaDefinition}
 * @see {@link ValidationResult}
 */
export class Schema<T extends Document = Document> {
  readonly definition: SchemaDefinition;
  readonly version: number;
  private readonly requiredFields: Set<string>;

  constructor(definition: SchemaDefinition) {
    this.definition = definition;
    this.version = definition.version ?? 1;
    this.requiredFields = new Set(definition.required ?? []);

    // Add fields marked as required in their definition
    for (const [name, field] of Object.entries(definition.properties)) {
      if (field.required) {
        this.requiredFields.add(name);
      }
    }
  }

  /**
   * Validate a document against the schema.
   *
   * Checks type constraints, required fields, value ranges, patterns,
   * and nested objects. Does not modify the document.
   *
   * @param doc - The document to validate
   * @returns Validation result with errors array
   *
   * @example
   * ```typescript
   * const result = schema.validate(document);
   * if (!result.valid) {
   *   for (const error of result.errors) {
   *     console.log(`${error.path}: ${error.message}`);
   *   }
   * }
   * ```
   */
  validate(doc: unknown): ValidationResult {
    const errors: FieldValidationError[] = [];

    if (typeof doc !== 'object' || doc === null) {
      return {
        valid: false,
        errors: [{ path: '', message: 'Document must be an object' }],
      };
    }

    const docObj = doc as Record<string, unknown>;

    // Check required fields
    for (const field of this.requiredFields) {
      if (!(field in docObj) || docObj[field] === undefined) {
        errors.push({
          path: field,
          message: `Required field "${field}" is missing`,
        });
      }
    }

    // Validate each field
    for (const [name, value] of Object.entries(docObj)) {
      // Skip internal fields
      if (name.startsWith('_')) continue;

      const fieldDef = this.definition.properties[name];

      if (!fieldDef) {
        if (this.definition.additionalProperties === false) {
          errors.push({
            path: name,
            message: `Unknown field "${name}" is not allowed`,
          });
        }
        continue;
      }

      const fieldErrors = this.validateField(name, value, fieldDef);
      errors.push(...fieldErrors);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Apply default values to a partial document.
   *
   * For each field with a default value defined in the schema,
   * if the field is missing from the document, the default is applied.
   *
   * @param doc - Partial document to apply defaults to
   * @returns New document with defaults applied (original is unchanged)
   *
   * @example
   * ```typescript
   * const schema = new Schema({
   *   properties: {
   *     name: { type: 'string', required: true },
   *     role: { type: 'string', default: 'user' },
   *     createdAt: { type: 'date', default: () => new Date() }
   *   }
   * });
   *
   * const doc = schema.applyDefaults({ name: 'Alice' });
   * // { name: 'Alice', role: 'user', createdAt: Date }
   * ```
   */
  applyDefaults(doc: Partial<T>): Partial<T> {
    const result = { ...doc };

    for (const [name, fieldDef] of Object.entries(this.definition.properties)) {
      if (fieldDef.default !== undefined && !(name in result)) {
        (result as Record<string, unknown>)[name] =
          typeof fieldDef.default === 'function'
            ? fieldDef.default()
            : structuredClone(fieldDef.default);
      }
    }

    return result;
  }

  /**
   * Validate a single field value
   */
  private validateField(
    path: string,
    value: unknown,
    def: FieldDefinition
  ): FieldValidationError[] {
    const errors: FieldValidationError[] = [];

    // Check type
    const types = Array.isArray(def.type) ? def.type : [def.type];
    const actualType = this.getType(value);

    if (!types.includes(actualType) && !types.includes('any')) {
      errors.push({
        path,
        message: `Expected type "${types.join(' | ')}", got "${actualType}"`,
      });
      return errors;
    }

    // Check enum
    if (def.enum && !def.enum.includes(value)) {
      errors.push({
        path,
        message: `Value must be one of: ${def.enum.join(', ')}`,
      });
    }

    // Check min/max for numbers
    if (typeof value === 'number') {
      if (def.min !== undefined && value < def.min) {
        errors.push({
          path,
          message: `Value must be at least ${def.min}`,
        });
      }
      if (def.max !== undefined && value > def.max) {
        errors.push({
          path,
          message: `Value must be at most ${def.max}`,
        });
      }
    }

    // Check min/max length for strings
    if (typeof value === 'string') {
      if (def.min !== undefined && value.length < def.min) {
        errors.push({
          path,
          message: `String must be at least ${def.min} characters`,
        });
      }
      if (def.max !== undefined && value.length > def.max) {
        errors.push({
          path,
          message: `String must be at most ${def.max} characters`,
        });
      }
      if (def.pattern) {
        const regex = typeof def.pattern === 'string' ? new RegExp(def.pattern) : def.pattern;
        if (!regex.test(value)) {
          errors.push({
            path,
            message: `String must match pattern ${def.pattern}`,
          });
        }
      }
    }

    // Check array items
    if (Array.isArray(value) && def.items) {
      if (def.min !== undefined && value.length < def.min) {
        errors.push({
          path,
          message: `Array must have at least ${def.min} items`,
        });
      }
      if (def.max !== undefined && value.length > def.max) {
        errors.push({
          path,
          message: `Array must have at most ${def.max} items`,
        });
      }
      for (let i = 0; i < value.length; i++) {
        const itemErrors = this.validateField(`${path}[${i}]`, value[i], def.items);
        errors.push(...itemErrors);
      }
    }

    // Check nested object
    if (typeof value === 'object' && value !== null && !Array.isArray(value) && def.properties) {
      for (const [name, nestedDef] of Object.entries(def.properties)) {
        const nestedValue = (value as Record<string, unknown>)[name];
        if (nestedValue !== undefined) {
          const nestedErrors = this.validateField(`${path}.${name}`, nestedValue, nestedDef);
          errors.push(...nestedErrors);
        } else if (nestedDef.required) {
          errors.push({
            path: `${path}.${name}`,
            message: `Required field "${name}" is missing`,
          });
        }
      }
    }

    return errors;
  }

  /**
   * Get the type of a value
   */
  private getType(value: unknown): FieldType {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    if (value instanceof Date) return 'date';
    const type = typeof value;
    if (type === 'string' || type === 'number' || type === 'boolean' || type === 'object') {
      return type;
    }
    return 'any';
  }
}

/**
 * Details about a single field validation error.
 *
 * @see {@link ValidationResult}
 */
export interface FieldValidationError {
  /**
   * The field path where the error occurred.
   * For nested fields, uses dot notation (e.g., 'address.city').
   * For array items, uses bracket notation (e.g., 'items[0].name').
   */
  path: string;

  /** Human-readable description of the validation failure */
  message: string;
}

/**
 * Result of validating a document against a schema.
 *
 * @example
 * ```typescript
 * const result = schema.validate(document);
 *
 * if (result.valid) {
 *   await collection.insert(document);
 * } else {
 *   // Show errors to user
 *   const errorMessages = result.errors
 *     .map(e => `${e.path}: ${e.message}`)
 *     .join('\n');
 *   showValidationErrors(errorMessages);
 * }
 * ```
 *
 * @see {@link Schema.validate}
 * @see {@link ValidationError}
 */
export interface ValidationResult {
  /** Whether the document passed all validation rules */
  valid: boolean;

  /** List of validation errors (empty if valid is true) */
  errors: FieldValidationError[];
}
