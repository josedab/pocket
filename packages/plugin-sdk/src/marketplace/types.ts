/**
 * Marketplace registry types for plugin discovery, installation, and publishing.
 */

/** Plugin registry entry */
export interface PluginRegistryEntry {
  name: string;
  displayName: string;
  description: string;
  author: PluginAuthor;
  version: string;
  versions: PluginVersionEntry[];
  repository?: string;
  homepage?: string;
  license: string;
  keywords: string[];
  category: MarketplacePluginCategory;
  downloads: number;
  rating: PluginRating;
  compatibility: CompatibilityMatrix;
  createdAt: number;
  updatedAt: number;
  verified: boolean;
  deprecated: boolean;
}

export interface PluginAuthor {
  name: string;
  email?: string;
  url?: string;
}

export interface PluginVersionEntry {
  version: string;
  publishedAt: number;
  checksum: string;
  size: number;
  pocketCoreVersion: string;
  nodeVersion?: string;
  changelog?: string;
  deprecated?: boolean;
}

export type MarketplacePluginCategory =
  | 'storage'
  | 'sync'
  | 'auth'
  | 'analytics'
  | 'ui'
  | 'migration'
  | 'validation'
  | 'security'
  | 'performance'
  | 'integration'
  | 'other';

export interface PluginRating {
  average: number;
  count: number;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
}

export interface CompatibilityMatrix {
  pocketCore: string; // semver range
  nodeVersions?: string[];
  platforms?: ('browser' | 'node' | 'deno' | 'bun' | 'react-native')[];
  peerDependencies?: Record<string, string>;
}

export interface PluginReview {
  author: string;
  rating: number;
  comment: string;
  version: string;
  createdAt: number;
  helpful: number;
}

/** Search/filter options */
export interface PluginSearchOptions {
  query?: string;
  category?: MarketplacePluginCategory;
  verified?: boolean;
  sortBy?: 'relevance' | 'downloads' | 'rating' | 'newest' | 'updated';
  page?: number;
  pageSize?: number;
  compatibility?: { pocketCore?: string; platform?: string };
}

export interface MarketplacePluginSearchResult {
  plugins: PluginRegistryEntry[];
  total: number;
  page: number;
  pageSize: number;
  facets: {
    categories: Record<string, number>;
    platforms: Record<string, number>;
  };
}

/** Installation result */
export interface PluginInstallResult {
  name: string;
  version: string;
  dependencies: string[];
  success: boolean;
  duration: number;
  warnings: string[];
}

/** Registry API configuration */
export interface MarketplaceRegistryConfig {
  registryUrl: string;
  authToken?: string;
  timeout?: number;
  retries?: number;
  namespace?: string; // @pocket-community/
}

/** Plugin publish options */
export interface PublishOptions {
  access: 'public' | 'restricted';
  tag?: string;
  dryRun?: boolean;
}
