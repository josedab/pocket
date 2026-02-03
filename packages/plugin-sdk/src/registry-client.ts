/**
 * Plugin Registry Client — search, discover, and install plugins.
 */

import type { PluginCategory, RegistryConfig, RegistrySearchResult } from './types.js';

const DEFAULT_REGISTRY_URL = 'https://registry.pocket-db.dev';

/**
 * Client for the Pocket plugin registry.
 */
export class RegistryClient {
  private readonly registryUrl: string;
  // In-memory catalog for offline/testing scenarios
  private readonly localCatalog: RegistrySearchResult[] = [];

  constructor(config: RegistryConfig = {}) {
    this.registryUrl = config.registryUrl ?? DEFAULT_REGISTRY_URL;
  }

  /**
   * Search the registry for plugins.
   */
  async search(
    query: string,
    options?: { category?: PluginCategory; limit?: number },
  ): Promise<RegistrySearchResult[]> {
    const limit = options?.limit ?? 20;
    const lower = query.toLowerCase();

    // Use local catalog (in production this would hit the registry API)
    let results = this.localCatalog.filter(
      (p) =>
        p.name.toLowerCase().includes(lower) ||
        p.description.toLowerCase().includes(lower) ||
        p.keywords.some((k) => k.toLowerCase().includes(lower)),
    );

    if (options?.category) {
      results = results.filter((p) => p.category === options.category);
    }

    return results
      .sort((a, b) => b.downloads - a.downloads)
      .slice(0, limit);
  }

  /**
   * Get plugin details by name.
   */
  async getPlugin(name: string): Promise<RegistrySearchResult | undefined> {
    return this.localCatalog.find((p) => p.name === name);
  }

  /**
   * List plugins by category.
   */
  async listByCategory(
    category: PluginCategory,
    limit = 20,
  ): Promise<RegistrySearchResult[]> {
    return this.localCatalog
      .filter((p) => p.category === category)
      .sort((a, b) => b.downloads - a.downloads)
      .slice(0, limit);
  }

  /**
   * Get featured/popular plugins.
   */
  async getFeatured(limit = 10): Promise<RegistrySearchResult[]> {
    return this.localCatalog
      .sort((a, b) => b.rating - a.rating || b.downloads - a.downloads)
      .slice(0, limit);
  }

  /**
   * Register a plugin in the local catalog (for testing).
   */
  registerLocal(plugin: RegistrySearchResult): void {
    const existing = this.localCatalog.findIndex((p) => p.name === plugin.name);
    if (existing >= 0) {
      this.localCatalog[existing] = plugin;
    } else {
      this.localCatalog.push(plugin);
    }
  }

  /**
   * Get the registry URL.
   */
  getRegistryUrl(): string {
    return this.registryUrl;
  }

  /**
   * Get the number of plugins in the local catalog.
   */
  get catalogSize(): number {
    return this.localCatalog.length;
  }
}

/**
 * Create a RegistryClient instance.
 */
export function createRegistryClient(config?: RegistryConfig): RegistryClient {
  return new RegistryClient(config);
}
