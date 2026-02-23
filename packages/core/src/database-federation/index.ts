export { DatabaseRegistry, createDatabaseRegistry } from './database-registry.js';

export type {
  DatabaseRegistryConfig,
  FederatableDatabase,
  FederatedQueryResult,
  FederatedQuerySpec,
  RegisteredDatabase,
  RegistryEvent,
  RegistryStats,
} from './database-registry.js';

export { FederatedQueryOptimizer, createFederatedQueryOptimizer } from './query-optimizer.js';

export type {
  FederatedOptimizerStats,
  FederatedPlanStep,
  FederatedQueryPlan,
  FederatedRegistry,
  JoinStrategy,
} from './query-optimizer.js';
