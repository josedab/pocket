/**
 * Marketplace Client — discover, search, and browse the Pocket plugin marketplace.
 *
 * Operates offline-first with a built-in local catalog and optional caching.
 *
 * @module @pocket/plugin-sdk/marketplace-client
 */

export interface MarketplaceConfig {
  /** Base URL for the plugin registry (default: https://plugins.pocket-db.dev) */
  registryUrl?: string;
  /** Cache TTL in milliseconds (default: 300000 = 5 minutes) */
  cacheTimeMs?: number;
}

export interface MarketplacePlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  downloads: number;
  rating: number;
  tags: string[];
  category: string;
  license: string;
  repository?: string;
  verified: boolean;
  publishedAt: number;
  updatedAt: number;
}

export interface MarketplaceSearchOptions {
  query?: string;
  category?: string;
  tags?: string[];
  sortBy?: 'downloads' | 'rating' | 'name' | 'updatedAt';
  sortDirection?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
  verified?: boolean;
}

export interface MarketplaceSearchResult {
  plugins: MarketplacePlugin[];
  total: number;
  page: number;
  pageSize: number;
}

const DEFAULT_REGISTRY_URL = 'https://plugins.pocket-db.dev';
const DEFAULT_CACHE_TIME_MS = 300_000;

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

/**
 * Built-in sample plugins for offline-first operation.
 */
const BUILTIN_CATALOG: MarketplacePlugin[] = [
  {
    id: 'pocket-encryption',
    name: '@pocket/encryption',
    version: '1.0.0',
    description: 'End-to-end encryption for Pocket documents',
    author: 'Pocket Team',
    downloads: 12500,
    rating: 4.8,
    tags: ['security', 'encryption', 'e2e'],
    category: 'security',
    license: 'MIT',
    repository: 'https://github.com/pocket-db/pocket',
    verified: true,
    publishedAt: 1700000000000,
    updatedAt: 1710000000000,
  },
  {
    id: 'pocket-analytics',
    name: '@pocket/analytics',
    version: '1.0.0',
    description: 'Usage analytics and query performance tracking',
    author: 'Pocket Team',
    downloads: 8700,
    rating: 4.5,
    tags: ['analytics', 'metrics', 'performance'],
    category: 'analytics',
    license: 'MIT',
    repository: 'https://github.com/pocket-db/pocket',
    verified: true,
    publishedAt: 1700000000000,
    updatedAt: 1709000000000,
  },
  {
    id: 'pocket-full-text-search',
    name: '@pocket/full-text-search',
    version: '0.5.0',
    description: 'Full-text search indexing for Pocket collections',
    author: 'Community',
    downloads: 3200,
    rating: 4.2,
    tags: ['search', 'indexing', 'fts'],
    category: 'data',
    license: 'MIT',
    verified: false,
    publishedAt: 1705000000000,
    updatedAt: 1708000000000,
  },
  {
    id: 'pocket-backup',
    name: '@pocket/backup',
    version: '1.2.0',
    description: 'Automated backup and restore for Pocket databases',
    author: 'Pocket Team',
    downloads: 6100,
    rating: 4.6,
    tags: ['backup', 'restore', 'storage'],
    category: 'storage',
    license: 'MIT',
    repository: 'https://github.com/pocket-db/pocket',
    verified: true,
    publishedAt: 1702000000000,
    updatedAt: 1711000000000,
  },
  {
    id: 'pocket-sync-firebase',
    name: '@pocket/sync-firebase',
    version: '0.3.0',
    description: 'Firebase Firestore sync adapter for Pocket',
    author: 'Community',
    downloads: 1500,
    rating: 3.9,
    tags: ['sync', 'firebase', 'cloud'],
    category: 'sync',
    license: 'Apache-2.0',
    verified: false,
    publishedAt: 1706000000000,
    updatedAt: 1707000000000,
  },
];

/**
 * Client for the Pocket plugin marketplace.
 *
 * Provides offline-first search and discovery with an in-memory catalog
 * and a caching layer for search results.
 */
export class MarketplaceClient {
  private readonly registryUrl: string;
  private readonly cacheTimeMs: number;
  private readonly catalog: MarketplacePlugin[];
  private readonly cache = new Map<string, CacheEntry<unknown>>();

  constructor(config: MarketplaceConfig = {}) {
    this.registryUrl = config.registryUrl ?? DEFAULT_REGISTRY_URL;
    this.cacheTimeMs = config.cacheTimeMs ?? DEFAULT_CACHE_TIME_MS;
    this.catalog = [...BUILTIN_CATALOG];
  }

  /**
   * Search for plugins with filtering and sorting.
   */
  async search(options: MarketplaceSearchOptions = {}): Promise<MarketplaceSearchResult> {
    const cacheKey = `search:${JSON.stringify(options)}`;
    const cached = this.getFromCache<MarketplaceSearchResult>(cacheKey);
    if (cached) {
      return cached;
    }

    let results = [...this.catalog];

    // Filter by query text
    if (options.query) {
      const lower = options.query.toLowerCase();
      results = results.filter(
        (p) =>
          p.name.toLowerCase().includes(lower) ||
          p.description.toLowerCase().includes(lower) ||
          p.tags.some((t) => t.toLowerCase().includes(lower)),
      );
    }

    // Filter by category
    if (options.category) {
      results = results.filter((p) => p.category === options.category);
    }

    // Filter by tags
    if (options.tags && options.tags.length > 0) {
      results = results.filter((p) =>
        options.tags!.some((t) => p.tags.includes(t)),
      );
    }

    // Filter by verified
    if (options.verified !== undefined) {
      results = results.filter((p) => p.verified === options.verified);
    }

    // Sort
    const sortBy = options.sortBy ?? 'downloads';
    const dir = options.sortDirection === 'asc' ? 1 : -1;

    results.sort((a, b) => {
      switch (sortBy) {
        case 'downloads':
          return (a.downloads - b.downloads) * dir;
        case 'rating':
          return (a.rating - b.rating) * dir;
        case 'name':
          return a.name.localeCompare(b.name) * dir;
        case 'updatedAt':
          return (a.updatedAt - b.updatedAt) * dir;
        default:
          return 0;
      }
    });

    const total = results.length;
    const limit = options.limit ?? 20;
    const offset = options.offset ?? 0;
    const paged = results.slice(offset, offset + limit);

    const searchResult: MarketplaceSearchResult = {
      plugins: paged,
      total,
      page: Math.floor(offset / limit) + 1,
      pageSize: limit,
    };

    this.setInCache(cacheKey, searchResult);
    return searchResult;
  }

  /**
   * Get a single plugin by ID.
   */
  async getPlugin(id: string): Promise<MarketplacePlugin | null> {
    return this.catalog.find((p) => p.id === id) ?? null;
  }

  /**
   * Get all unique categories in the catalog.
   */
  async getCategories(): Promise<string[]> {
    const categories = new Set(this.catalog.map((p) => p.category));
    return Array.from(categories).sort();
  }

  /**
   * Get featured plugins (verified, highest rated).
   */
  async getFeatured(): Promise<MarketplacePlugin[]> {
    return this.catalog
      .filter((p) => p.verified)
      .sort((a, b) => b.rating - a.rating || b.downloads - a.downloads);
  }

  /**
   * Get the most popular plugins by download count.
   */
  async getPopular(limit = 10): Promise<MarketplacePlugin[]> {
    return [...this.catalog]
      .sort((a, b) => b.downloads - a.downloads)
      .slice(0, limit);
  }

  /**
   * Get all plugins by a specific author.
   */
  async getByAuthor(author: string): Promise<MarketplacePlugin[]> {
    const lower = author.toLowerCase();
    return this.catalog.filter((p) => p.author.toLowerCase() === lower);
  }

  /**
   * Check whether a plugin is compatible with a given Pocket version.
   *
   * For the built-in catalog, all plugins are compatible with version 0.x.
   */
  async checkCompatibility(pluginId: string, pocketVersion: string): Promise<boolean> {
    const plugin = await this.getPlugin(pluginId);
    if (!plugin) {
      return false;
    }
    // Simple compatibility: major version must match
    const pluginMajor = parseInt(plugin.version.split('.')[0] ?? '0', 10);
    const pocketMajor = parseInt(pocketVersion.split('.')[0] ?? '0', 10);
    return pluginMajor <= pocketMajor || pocketMajor === 0;
  }

  /**
   * Get the registry URL.
   */
  getRegistryUrl(): string {
    return this.registryUrl;
  }

  private getFromCache<T>(key: string): T | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    if (!entry) {
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  private setInCache<T>(key: string, data: T): void {
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + this.cacheTimeMs,
    });
  }
}

/**
 * Create a new MarketplaceClient instance.
 */
export function createMarketplaceClient(config?: MarketplaceConfig): MarketplaceClient {
  return new MarketplaceClient(config);
}
