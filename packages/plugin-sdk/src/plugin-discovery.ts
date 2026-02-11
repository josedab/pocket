/**
 * Plugin Discovery — search and filter available plugins.
 *
 * @example
 * ```typescript
 * const discovery = createPluginDiscovery();
 * discovery.addPlugin({ name: 'my-plugin', ... });
 * const results = discovery.search('auth');
 * ```
 *
 * @module @pocket/plugin-sdk/plugin-discovery
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A plugin entry in the discovery registry */
export interface PluginEntry {
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly author: string;
  readonly category: string;
  readonly keywords: string[];
  readonly downloads: number;
  readonly score: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** Plugin discovery interface */
export interface PluginDiscovery {
  addPlugin(entry: PluginEntry): void;
  search(query: string): PluginEntry[];
  filterByCategory(category: string): PluginEntry[];
  filterByScore(minScore: number): PluginEntry[];
  getPopular(limit?: number): PluginEntry[];
  getRecent(limit?: number): PluginEntry[];
  getAllPlugins(): PluginEntry[];
  getCategories(): string[];
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Create a plugin discovery instance with optional initial plugins */
export function createPluginDiscovery(plugins?: PluginEntry[]): PluginDiscovery {
  const entries: PluginEntry[] = plugins ? [...plugins] : [];

  return {
    addPlugin(entry: PluginEntry): void {
      entries.push(entry);
    },

    search(query: string): PluginEntry[] {
      const q = query.toLowerCase();
      return entries.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          e.keywords.some((k) => k.toLowerCase().includes(q))
      );
    },

    filterByCategory(category: string): PluginEntry[] {
      return entries.filter((e) => e.category === category);
    },

    filterByScore(minScore: number): PluginEntry[] {
      return entries.filter((e) => e.score >= minScore);
    },

    getPopular(limit = 10): PluginEntry[] {
      return [...entries].sort((a, b) => b.downloads - a.downloads).slice(0, limit);
    },

    getRecent(limit = 10): PluginEntry[] {
      return [...entries].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
    },

    getAllPlugins(): PluginEntry[] {
      return [...entries];
    },

    getCategories(): string[] {
      return [...new Set(entries.map((e) => e.category))];
    },
  };
}
