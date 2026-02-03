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
  PluginManifest,
  PluginCategory,
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
  type PluginInstallFn,
  type PluginHookRegistry,
} from './test-harness.js';

// Registry Client
export { RegistryClient, createRegistryClient } from './registry-client.js';

// Hook System
export {
  HookSystem,
  createHookSystem,
  type HookName,
  type HookPriority,
  type HookRegistration,
  type HookHandler,
  type HookContext,
  type HookResult,
} from './hook-system.js';

// Lifecycle Manager
export {
  PluginLifecycleManager,
  createLifecycleManager,
  type PluginStatus,
  type PluginInstance,
  type PluginLifecycleHooks,
  type PluginRegistration,
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
