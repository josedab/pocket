import type { Document } from '../types/document.js';
import type { IndexDefinition } from '../types/storage.js';

/**
 * Field types supported by schema
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
 * Field definition in schema
 */
export interface FieldDefinition {
  /** Field type */
  type: FieldType | FieldType[];
  /** Whether field is required */
  required?: boolean;
  /** Default value */
  default?: unknown;
  /** Minimum value (for numbers) or length (for strings/arrays) */
  min?: number;
  /** Maximum value (for numbers) or length (for strings/arrays) */
  max?: number;
  /** Pattern for string validation */
  pattern?: string | RegExp;
  /** Enum values */
  enum?: unknown[];
  /** Nested schema for objects */
  properties?: SchemaDefinition['properties'];
  /** Array item schema */
  items?: FieldDefinition;
}

/**
 * Schema definition for a collection
 */
export interface SchemaDefinition {
  /** Schema version for migrations */
  version?: number;
  /** Field definitions */
  properties: Record<string, FieldDefinition>;
  /** Whether to allow additional properties not in schema */
  additionalProperties?: boolean;
  /** Required field names */
  required?: string[];
}

/**
 * Collection configuration
 */
export interface CollectionConfig<T extends Document = Document> {
  /** Collection name */
  name: string;
  /** Schema definition */
  schema?: SchemaDefinition;
  /** Index definitions */
  indexes?: IndexDefinition[];
  /** Default sort field */
  defaultSort?: keyof T & string;
  /** Time-to-live in ms (for auto-expiry) */
  ttl?: number;
  /** Whether collection syncs with server */
  sync?: boolean;
  /** Conflict resolution strategy */
  conflictStrategy?: 'server-wins' | 'client-wins' | 'last-write-wins' | 'merge';
}

/**
 * Database configuration
 */
export interface DatabaseConfig {
  /** Database name */
  name: string;
  /** Database version */
  version?: number;
  /** Collection configurations */
  collections?: CollectionConfig[];
}

/**
 * Schema class for runtime type validation and defaults
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
   * Validate a document against the schema
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
   * Apply default values to a document
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
 * Field validation error
 */
export interface FieldValidationError {
  path: string;
  message: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: FieldValidationError[];
}
