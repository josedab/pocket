export { diffSchemas, evolveDocument, generateMigrationFromDiff } from './schema-evolution.js';

export type {
  DocumentEvolutionResult,
  SchemaChange,
  SchemaChangeType,
  SchemaDiffResult,
  SchemaEvolutionConfig,
} from './schema-evolution.js';

export {
  SchemaVersionRegistry,
  createSchemaVersionRegistry,
} from './schema-registry.js';

export type {
  CompatibilityIssue,
  CompatibilityLevel,
  CompatibilityResult,
  SchemaVersionEntry,
} from './schema-registry.js';

export {
  AutoMigrationEngine,
  createAutoMigrationEngine,
} from './auto-migration.js';

export type {
  AutoMigrationResult,
  MigrationPlan,
  MigrationStep,
  SimulationResult,
} from './auto-migration.js';
