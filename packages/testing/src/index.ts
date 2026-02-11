// Types
export type {
  ConflictScenario,
  ConsistencyCheckResult,
  DataDifference,
  NetworkCondition,
  NetworkSimulator,
  NetworkSimulatorConfig,
  NetworkState,
  SyncTestHarness,
  SyncTimeline,
  TestClient,
  TestServer,
  TimelineEvent,
} from './types.js';

// Network Simulator
export { createNetworkSimulator } from './network-simulator.js';

// Conflict Injector
export { createConflictInjector } from './conflict-injector.js';
export type { ConflictInjector } from './conflict-injector.js';

// Consistency Checker
export { createConsistencyChecker } from './consistency-checker.js';
export type { ConsistencyChecker } from './consistency-checker.js';

// Sync Test Harness
export { createSyncTestHarness } from './sync-test-harness.js';
export type { SyncTestHarnessController } from './sync-test-harness.js';

// Scenario Runner
export {
  LATENCY_PROFILES,
  ScenarioRunner,
  createScenarioRunner,
  type LatencyProfile,
  type ReplayLog,
  type ScenarioDefinition,
  type ScenarioResult,
  type ScenarioStep,
  type StepResult,
} from './scenario-runner.js';
