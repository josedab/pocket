/**
 * Supported field types for collection fields.
 */
export type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'object' | 'array' | 'enum';

/**
 * Defines a relation between collections.
 */
export interface RelationDef {
  collection: string;
  type: 'one-to-one' | 'one-to-many' | 'many-to-many';
}

/**
 * Defines a single field within a collection.
 */
export interface FieldDef {
  name: string;
  type: FieldType;
  required?: boolean;
  default?: unknown;
  unique?: boolean;
  indexed?: boolean;
  relation?: RelationDef;
}

/**
 * Defines a collection (table/store) in the schema.
 */
export interface CollectionDef {
  name: string;
  fields: FieldDef[];
  primaryKey?: string;
  timestamps?: boolean;
  softDelete?: boolean;
}

/**
 * Top-level schema definition describing the data model.
 */
export interface SchemaDefinition {
  name: string;
  version: string;
  collections: CollectionDef[];
}

/**
 * Available code generation targets.
 */
export type GeneratorTarget = 'typescript' | 'react-hooks' | 'api-routes' | 'migration' | 'validation';

/**
 * Represents a single generated file.
 */
export interface GeneratedFile {
  path: string;
  content: string;
  overwrite?: boolean;
}

/**
 * Configuration for the code generator.
 */
export interface GeneratorConfig {
  schema: SchemaDefinition;
  outputDir: string;
  targets: GeneratorTarget[];
  framework?: 'next' | 'express';
}

/**
 * Result of a code generation run.
 */
export interface GeneratorResult {
  files: GeneratedFile[];
  warnings: string[];
}

/**
 * Describes a single change between two schema versions.
 */
export interface SchemaDiff {
  type: 'add-collection' | 'remove-collection' | 'add-field' | 'remove-field' | 'change-field-type';
  collection: string;
  field?: string;
  from?: string;
  to?: string;
}
