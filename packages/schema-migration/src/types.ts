/**
 * @pocket/schema-migration — Types for the type-safe migration toolkit.
 *
 * @module @pocket/schema-migration
 */

// ── Schema Types ──────────────────────────────────────────

export type FieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'object'
  | 'array'
  | 'date'
  | 'binary'
  | 'null';

export interface FieldDefinition {
  name: string;
  type: FieldType;
  required?: boolean;
  defaultValue?: unknown;
  indexed?: boolean;
  unique?: boolean;
}

export interface CollectionSchema {
  name: string;
  version: number;
  fields: FieldDefinition[];
  indexes?: IndexDefinition[];
  primaryKey?: string;
}

export interface IndexDefinition {
  name: string;
  fields: string[];
  unique?: boolean;
  sparse?: boolean;
}

export interface DatabaseSchema {
  version: number;
  collections: CollectionSchema[];
}

// ── Migration Types ───────────────────────────────────────

export type MigrationDirection = 'up' | 'down';

export interface Migration {
  version: number;
  name: string;
  description?: string;
  timestamp: number;
  up: MigrationStep[];
  down: MigrationStep[];
}

export type MigrationStep =
  | CreateCollectionStep
  | DropCollectionStep
  | RenameCollectionStep
  | AddFieldStep
  | RemoveFieldStep
  | RenameFieldStep
  | ModifyFieldStep
  | AddIndexStep
  | RemoveIndexStep
  | TransformDataStep;

export interface CreateCollectionStep {
  type: 'createCollection';
  collection: string;
  schema: CollectionSchema;
}

export interface DropCollectionStep {
  type: 'dropCollection';
  collection: string;
}

export interface RenameCollectionStep {
  type: 'renameCollection';
  from: string;
  to: string;
}

export interface AddFieldStep {
  type: 'addField';
  collection: string;
  field: FieldDefinition;
}

export interface RemoveFieldStep {
  type: 'removeField';
  collection: string;
  fieldName: string;
}

export interface RenameFieldStep {
  type: 'renameField';
  collection: string;
  from: string;
  to: string;
}

export interface ModifyFieldStep {
  type: 'modifyField';
  collection: string;
  fieldName: string;
  changes: Partial<FieldDefinition>;
}

export interface AddIndexStep {
  type: 'addIndex';
  collection: string;
  index: IndexDefinition;
}

export interface RemoveIndexStep {
  type: 'removeIndex';
  collection: string;
  indexName: string;
}

export interface TransformDataStep {
  type: 'transformData';
  collection: string;
  transform: (doc: Record<string, unknown>) => Record<string, unknown>;
  description?: string;
}

// ── Runner Types ──────────────────────────────────────────

export type MigrationStatus = 'pending' | 'applied' | 'failed' | 'rolled_back';

export interface MigrationRecord {
  version: number;
  name: string;
  status: MigrationStatus;
  appliedAt: number | null;
  rolledBackAt: number | null;
  executionTimeMs: number;
  error?: string;
}

export interface MigrationPlan {
  direction: MigrationDirection;
  migrations: Migration[];
  currentVersion: number;
  targetVersion: number;
}

export interface MigrationResult {
  success: boolean;
  migrationsRun: number;
  fromVersion: number;
  toVersion: number;
  duration: number;
  results: MigrationStepResult[];
  error?: string;
}

export interface MigrationStepResult {
  version: number;
  name: string;
  direction: MigrationDirection;
  success: boolean;
  durationMs: number;
  stepsExecuted: number;
  error?: string;
}

export type MigrationEvent =
  | { type: 'plan_created'; plan: MigrationPlan }
  | { type: 'migration_start'; version: number; name: string; direction: MigrationDirection }
  | { type: 'migration_complete'; version: number; name: string; durationMs: number }
  | { type: 'migration_error'; version: number; name: string; error: string }
  | { type: 'step_execute'; version: number; stepType: string; collection?: string }
  | { type: 'rollback_start'; version: number }
  | { type: 'rollback_complete'; version: number };

// ── Storage Types ─────────────────────────────────────────

export interface MigrationStore {
  getAppliedMigrations(): Promise<MigrationRecord[]>;
  getCurrentVersion(): Promise<number>;
  recordMigration(record: MigrationRecord): Promise<void>;
  updateMigration(version: number, updates: Partial<MigrationRecord>): Promise<void>;
  getCollectionData(collection: string): Promise<Record<string, unknown>[]>;
  setCollectionData(collection: string, data: Record<string, unknown>[]): Promise<void>;
  createCollection(collection: string): Promise<void>;
  dropCollection(collection: string): Promise<void>;
  renameCollection(from: string, to: string): Promise<void>;
  collectionExists(collection: string): Promise<boolean>;
}

// ── Diff Types ────────────────────────────────────────────

export type SchemaDiffChange =
  | { type: 'collection_added'; collection: CollectionSchema }
  | { type: 'collection_removed'; collection: string }
  | { type: 'collection_renamed'; from: string; to: string }
  | { type: 'field_added'; collection: string; field: FieldDefinition }
  | { type: 'field_removed'; collection: string; fieldName: string }
  | { type: 'field_modified'; collection: string; fieldName: string; changes: Partial<FieldDefinition> }
  | { type: 'index_added'; collection: string; index: IndexDefinition }
  | { type: 'index_removed'; collection: string; indexName: string };

export interface SchemaDiff {
  changes: SchemaDiffChange[];
  isBreaking: boolean;
  summary: string;
}
