/**
 * Types for the Plugin SDK.
 */

export interface PluginManifest {
  /** Unique plugin identifier (npm package name) */
  name: string;
  /** Semver version */
  version: string;
  /** Human-readable description */
  description: string;
  /** Author name or email */
  author: string;
  /** Plugin category */
  category: PluginCategory;
  /** Required Pocket core version range */
  pocketVersion: string;
  /** Plugin keywords for search */
  keywords?: string[];
  /** Repository URL */
  repository?: string;
  /** Homepage URL */
  homepage?: string;
  /** License identifier */
  license?: string;
  /** Hooks this plugin uses */
  hooks?: string[];
  /** Optional peer dependencies */
  peerDependencies?: Record<string, string>;
}

export type PluginCategory =
  | 'storage'
  | 'sync'
  | 'security'
  | 'analytics'
  | 'ui'
  | 'data'
  | 'devtools'
  | 'integration'
  | 'other';

export interface PluginTestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

export interface PluginValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface RegistrySearchResult {
  name: string;
  version: string;
  description: string;
  author: string;
  category: PluginCategory;
  downloads: number;
  rating: number;
  keywords: string[];
}

export interface RegistryConfig {
  /** Registry base URL (default: https://registry.pocket-db.dev) */
  registryUrl?: string;
  /** Auth token for publishing */
  authToken?: string;
}
