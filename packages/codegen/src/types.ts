/**
 * @pocket/codegen - Schema Definition Types
 *
 * Type definitions for Pocket schema-driven code generation.
 *
 * @module @pocket/codegen
 */

/**
 * Field types supported in schema definitions.
 */
export type SchemaFieldType = 'string' | 'number' | 'boolean' | 'date' | 'array' | 'object' | 'reference';

/**
 * Schema field definition describing the shape and constraints of a single field.
 */
export interface SchemaField {
  /** The data type of the field */
  type: SchemaFieldType;
  /** Whether the field is required (default: false) */
  required?: boolean;
  /** Default value for the field */
  default?: unknown;
  /** Human-readable description of the field */
  description?: string;
  /** For array type: schema of the array items */
  items?: SchemaField;
  /** For object type: nested field definitions */
  properties?: Record<string, SchemaField>;
  /** For reference type: target collection and optional field */
  reference?: { collection: string; field?: string };
  /** Validation constraints */
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    enum?: unknown[];
  };
  /** Whether this field should be indexed */
  index?: boolean;
  /** Whether this field must be unique */
  unique?: boolean;
}

/**
 * Collection schema defining the structure of a document collection.
 */
export interface CollectionSchema {
  /** Collection name (used as the storage key) */
  name: string;
  /** Human-readable description of the collection */
  description?: string;
  /** Field definitions for documents in this collection */
  fields: Record<string, SchemaField>;
  /** Automatically add createdAt/updatedAt timestamp fields */
  timestamps?: boolean;
  /** Enable soft delete (_deleted flag instead of hard delete) */
  softDelete?: boolean;
  /** Compound indexes */
  indexes?: { fields: string[]; unique?: boolean }[];
}

/**
 * Top-level Pocket schema definition containing all collections and options.
 */
export interface PocketSchema {
  /** Schema version identifier */
  version: string;
  /** Collection definitions */
  collections: CollectionSchema[];
  /** Code generation options */
  options?: {
    /** Generate React hooks for each collection */
    generateReactHooks?: boolean;
    /** Generate Zod validation schemas */
    generateZodSchemas?: boolean;
    /** Default output directory for generated files */
    outputDir?: string;
  };
}

/**
 * Options controlling what code is generated and where.
 */
export interface GeneratorOptions {
  /** The parsed schema to generate code from */
  schema: PocketSchema;
  /** Output directory for generated files */
  outputDir: string;
  /** Generate TypeScript type definitions (default: true) */
  generateTypes?: boolean;
  /** Generate React hooks (default: false) */
  generateHooks?: boolean;
  /** Generate Zod validation schemas (default: false) */
  generateValidation?: boolean;
  /** Generate migration files (default: false) */
  generateMigrations?: boolean;
}

/**
 * Represents a single generated file with its path, content, and category.
 */
export interface GeneratedFile {
  /** Relative path for the generated file */
  path: string;
  /** Full source content of the generated file */
  content: string;
  /** Category of the generated file */
  type: 'types' | 'hooks' | 'validation' | 'migration' | 'crud' | 'index';
}
