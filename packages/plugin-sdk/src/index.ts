/**
 * @pocket/plugin-sdk — Build, test, and publish Pocket plugins
 *
 * @example
 * ```typescript
 * import {
 *   createPluginTestHarness,
 *   validateManifest,
 *   createRegistryClient,
 * } from '@pocket/plugin-sdk';
 *
 * // Validate your plugin manifest
 * const result = validateManifest({
 *   name: '@pocket/my-plugin',
 *   version: '1.0.0',
 *   description: 'My custom Pocket plugin',
 *   author: 'Alice',
 *   category: 'data',
 *   pocketVersion: '>=0.1.0',
 * });
 *
 * // Test your plugin in isolation
 * const harness = createPluginTestHarness();
 * harness.install(myPlugin);
 * const doc = await harness.simulateInsert('users', { name: 'Alice' });
 * ```
 *
 * @module @pocket/plugin-sdk
 */

// Types
export type {
  PluginCategory,
  PluginManifest,
  PluginTestResult,
  PluginValidationResult,
  RegistryConfig,
  RegistrySearchResult,
} from './types.js';

// Validator
export { validateManifest, validatePluginStructure } from './validator.js';

// Test Harness
export {
  MockDatabase,
  PluginTestHarness,
  createPluginTestHarness,
  type MockCollection,
  type MockDatabaseConfig,
  type PluginHookRegistry,
  type PluginInstallFn,
} from './test-harness.js';

// Registry Client
export { RegistryClient, createRegistryClient } from './registry-client.js';

// Hook System
export {
  HookSystem,
  createHookSystem,
  type HookContext,
  type HookHandler,
  type HookName,
  type HookPriority,
  type HookRegistration,
  type HookResult,
} from './hook-system.js';

// Lifecycle Manager
export {
  PluginLifecycleManager,
  createLifecycleManager,
  type PluginInstance,
  type PluginLifecycleHooks,
  type PluginRegistration,
  type PluginStatus,
} from './lifecycle-manager.js';

// Marketplace Client
export {
  MarketplaceClient,
  createMarketplaceClient,
  type MarketplaceConfig,
  type MarketplacePlugin,
  type MarketplaceSearchOptions,
  type MarketplaceSearchResult,
} from './marketplace-client.js';

// Plugin Scaffold
export {
  PluginScaffold,
  createPluginScaffold,
  type CompatibilityResult,
  type GeneratedFile,
  type PublishProgress,
  type PublishResult,
  type PublishStage,
  type QualityInput,
  type QualityScore,
  type ScaffoldOptions,
} from './plugin-scaffold.js';
