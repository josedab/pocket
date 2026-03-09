/**
 * @pocket/schema-migration — Type-safe schema migration toolkit.
 *
 * @example
 * ```ts
 * import { defineMigration, createMigrationRunner, InMemoryMigrationStore } from '@pocket/schema-migration';
 *
 * const m1 = defineMigration(1)
 *   .name('create-users')
 *   .createCollection('users', [
 *     { name: 'id', type: 'string', required: true },
 *     { name: 'email', type: 'string', required: true, unique: true },
 *   ])
 *   .addIndex('users', 'idx_email', ['email'], true)
 *   .build();
 *
 * const runner = createMigrationRunner({
 *   store: new InMemoryMigrationStore(),
 *   migrations: [m1],
 * });
 *
 * await runner.migrate(); // runs all pending
 * await runner.rollback(); // rolls back last migration
 * ```
 *
 * @module @pocket/schema-migration
 */

// Types
export type {
  AddFieldStep,
  AddIndexStep,
  CollectionSchema,
  CreateCollectionStep,
  DatabaseSchema,
  DropCollectionStep,
  FieldDefinition,
  FieldType,
  IndexDefinition,
  MigrationDirection,
  MigrationEvent,
  MigrationPlan,
  MigrationRecord,
  MigrationResult,
  MigrationStatus,
  MigrationStep,
  MigrationStepResult,
  MigrationStore,
  ModifyFieldStep,
  RemoveFieldStep,
  RemoveIndexStep,
  RenameCollectionStep,
  RenameFieldStep,
  SchemaDiff,
  SchemaDiffChange,
  TransformDataStep,
} from './types.js';

// Schema Diff
export { diffSchemas, generateMigrationSteps } from './schema-diff.js';

// Migration Runner
export {
  InMemoryMigrationStore,
  MigrationBuilder,
  MigrationRunner,
  createMigrationRunner,
  defineMigration,
} from './migration-runner.js';
export type { MigrationRunnerConfig } from './migration-runner.js';
