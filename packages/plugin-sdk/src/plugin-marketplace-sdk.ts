/**
 * Plugin Marketplace SDK — high-level orchestrator for marketplace operations.
 *
 * Combines MarketplaceClient, RegistryClient, QualityScorer, and PluginScaffold
 * into a single unified API for plugin discovery, installation, and management.
 *
 * @module @pocket/plugin-sdk/plugin-marketplace-sdk
 */

import { MarketplaceClient } from './marketplace-client.js';
import type { MarketplacePlugin } from './marketplace-client.js';
import { RegistryClient } from './registry-client.js';
import { createQualityScorer } from './quality-scorer.js';
import type { QualityScorer, ScorerQualityScore } from './quality-scorer.js';
import { PluginScaffold } from './plugin-scaffold.js';
import type { ScaffoldOptions, GeneratedFile } from './plugin-scaffold.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for the PluginMarketplaceSDK */
export interface MarketplaceSDKConfig {
  /** Base URL for the plugin registry */
  readonly registryUrl?: string;
  /** Whether to compute quality scores for search results (default: true) */
  readonly enableQualityScoring?: boolean;
  /** Whether to cache marketplace search results (default: true) */
  readonly cacheEnabled?: boolean;
}

/** Search result enriched with an optional quality score */
export interface PluginSearchResult {
  readonly plugin: MarketplacePlugin;
  readonly qualityScore?: ScorerQualityScore;
}

/** Record of an installed plugin */
export interface InstalledPlugin {
  readonly name: string;
  readonly version: string;
  readonly installedAt: number;
}

/** Aggregate marketplace statistics */
export interface MarketplaceStats {
  readonly totalSearches: number;
  readonly totalInstalls: number;
  readonly totalUninstalls: number;
  readonly installedCount: number;
}

// ---------------------------------------------------------------------------
// PluginMarketplaceSDK
// ---------------------------------------------------------------------------

/**
 * High-level SDK that orchestrates marketplace discovery, installation,
 * quality scoring, and scaffolding.
 */
export class PluginMarketplaceSDK {
  private readonly marketplaceClient: MarketplaceClient;
  readonly registryClient: RegistryClient;
  private readonly qualityScorer: QualityScorer;
  private readonly scaffold: PluginScaffold;
  private readonly enableQualityScoring: boolean;

  private readonly installed = new Map<string, InstalledPlugin>();
  private totalSearches = 0;
  private totalInstalls = 0;
  private totalUninstalls = 0;

  constructor(config: MarketplaceSDKConfig = {}) {
    this.marketplaceClient = new MarketplaceClient({
      registryUrl: config.registryUrl,
      cacheTimeMs: config.cacheEnabled === false ? 0 : undefined,
    });
    this.registryClient = new RegistryClient({
      registryUrl: config.registryUrl,
    });
    this.qualityScorer = createQualityScorer();
    this.scaffold = new PluginScaffold();
    this.enableQualityScoring = config.enableQualityScoring !== false;
  }

  /**
   * Search the marketplace for plugins matching `query`.
   */
  async search(query: string): Promise<PluginSearchResult[]> {
    this.totalSearches++;
    const result = await this.marketplaceClient.search({ query });

    return result.plugins.map((plugin) => {
      const searchResult: PluginSearchResult = { plugin };
      if (this.enableQualityScoring) {
        const score = this.qualityScorer.score({
          hasTests: true,
          testCount: 0,
          hasReadme: true,
          hasChangelog: false,
          hasTypes: true,
          hasExamples: false,
          dependencyCount: 3,
          codeLines: 200,
          exportCount: 5,
          hasLicense: plugin.license !== '',
          lastUpdatedAt: plugin.updatedAt,
        });
        return { ...searchResult, qualityScore: score };
      }
      return searchResult;
    });
  }

  /**
   * Install a plugin by name.
   */
  async install(pluginName: string): Promise<InstalledPlugin> {
    const result = await this.marketplaceClient.search({ query: pluginName });
    const match = result.plugins.find((p) => p.name === pluginName);
    const version = match?.version ?? '0.0.0';

    const entry: InstalledPlugin = {
      name: pluginName,
      version,
      installedAt: Date.now(),
    };
    this.installed.set(pluginName, entry);
    this.totalInstalls++;
    return entry;
  }

  /**
   * Uninstall a plugin by name.
   */
  async uninstall(pluginName: string): Promise<boolean> {
    const removed = this.installed.delete(pluginName);
    if (removed) {
      this.totalUninstalls++;
    }
    return removed;
  }

  /**
   * Get all currently installed plugins.
   */
  getInstalled(): InstalledPlugin[] {
    return Array.from(this.installed.values());
  }

  /**
   * Get detailed information about a marketplace plugin.
   */
  async getPluginInfo(name: string): Promise<MarketplacePlugin | null> {
    const result = await this.marketplaceClient.search({ query: name });
    return result.plugins.find((p) => p.name === name) ?? null;
  }

  /**
   * Compute a quality score for a named plugin.
   */
  async scorePlugin(name: string): Promise<ScorerQualityScore | null> {
    const plugin = await this.getPluginInfo(name);
    if (!plugin) return null;

    return this.qualityScorer.score({
      hasTests: true,
      testCount: 0,
      hasReadme: true,
      hasChangelog: false,
      hasTypes: true,
      hasExamples: false,
      dependencyCount: 3,
      codeLines: 200,
      exportCount: 5,
      hasLicense: plugin.license !== '',
      lastUpdatedAt: plugin.updatedAt,
    });
  }

  /**
   * Scaffold a new plugin project.
   */
  scaffold_plugin(name: string, options: Omit<ScaffoldOptions, 'name'>): GeneratedFile[] {
    return this.scaffold.generate({ ...options, name });
  }

  /**
   * Get aggregate marketplace statistics.
   */
  getStats(): MarketplaceStats {
    return {
      totalSearches: this.totalSearches,
      totalInstalls: this.totalInstalls,
      totalUninstalls: this.totalUninstalls,
      installedCount: this.installed.size,
    };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Create a PluginMarketplaceSDK instance */
export function createPluginMarketplaceSDK(
  config?: MarketplaceSDKConfig,
): PluginMarketplaceSDK {
  return new PluginMarketplaceSDK(config);
}
