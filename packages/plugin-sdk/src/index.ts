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

// Quality Scorer
export {
  createQualityScorer,
  type PluginAnalysis,
  type QualityScorer,
  type ScorerQualityScore,
} from './quality-scorer.js';

// Plugin Discovery
export {
  createPluginDiscovery,
  type PluginDiscovery,
  type PluginEntry,
} from './plugin-discovery.js';

// Plugin Marketplace SDK
export {
  PluginMarketplaceSDK,
  createPluginMarketplaceSDK,
  type InstalledPlugin,
  type MarketplaceSDKConfig,
  type MarketplaceStats,
  type PluginSearchResult,
} from './plugin-marketplace-sdk.js';

// Security Scanner
export {
  SecurityScanner,
  createSecurityScanner,
  type PluginScanInput,
  type SecurityCategory,
  type SecurityFinding,
  type SecurityPattern,
  type SecurityScanResult,
  type SecurityScannerConfig,
  type SecuritySeverity,
} from './security-scanner.js';

// Marketplace Security Review
export {
  batchReviewPlugins,
  reviewPluginSecurity,
  type MarketplaceSecurityReview,
  type SecurityPolicy,
} from './marketplace-security.js';

// Publish Pipeline
export {
  publishPlugin,
  type PublishCheck,
  type PublishPipelineOptions,
  type PublishReadiness,
  type PublishReport,
} from './publish-pipeline.js';

// Dependency Audit
export {
  auditDependencies,
  getDefaultVulnDb,
  type DepAuditFinding,
  type DepAuditResult,
  type KnownVulnerability,
} from './dep-audit.js';

// Plugin Installer
export {
  PluginInstaller,
  createPluginInstaller,
  type InstallResult,
  type ManagedPlugin,
  type PluginInstallerConfig,
  type PluginInstallerEvent,
  type UninstallResult,
  type UpdateCheckResult,
} from './plugin-installer.js';

// Dependency Graph Visualizer
export { DependencyGraphBuilder, createDependencyGraphBuilder } from './dependency-graph.js';
export type {
  DependencyEdge,
  DependencyGraph,
  GraphAnalysis,
  PackageNode,
} from './dependency-graph.js';

// Template Scaffold
export { PluginTemplateScaffold, createTemplateScaffold } from './template-scaffold.js';
export type { ScaffoldResult, TemplateConfig } from './template-scaffold.js';

// Marketplace Registry
export * from './marketplace/index.js';
