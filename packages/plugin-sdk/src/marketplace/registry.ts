/**
 * Plugin Registry — search, install, publish, and manage marketplace plugins.
 */

import type { PluginManifest } from '../types.js';
import type {
  CompatibilityMatrix,
  MarketplacePluginCategory,
  MarketplacePluginSearchResult,
  MarketplaceRegistryConfig,
  PluginInstallResult,
  PluginRegistryEntry,
  PluginReview,
  PluginSearchOptions,
  PluginVersionEntry,
  PublishOptions,
} from './types.js';

/**
 * Parse a semver string into its numeric components.
 */
function parseSemver(version: string): { major: number; minor: number; patch: number } | null {
  const match = version.replace(/^[>=<^~]*/, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/**
 * Check whether a concrete version satisfies a semver range (simplified).
 * Supports exact, ^, ~, >= prefixes.
 */
function satisfiesSemver(version: string, range: string): boolean {
  const ver = parseSemver(version);
  const rangeVer = parseSemver(range);
  if (!ver || !rangeVer) return false;

  if (range.startsWith('>=')) {
    return (
      ver.major > rangeVer.major ||
      (ver.major === rangeVer.major && ver.minor > rangeVer.minor) ||
      (ver.major === rangeVer.major && ver.minor === rangeVer.minor && ver.patch >= rangeVer.patch)
    );
  }

  if (range.startsWith('^')) {
    if (rangeVer.major !== 0) {
      return ver.major === rangeVer.major && (
        ver.minor > rangeVer.minor ||
        (ver.minor === rangeVer.minor && ver.patch >= rangeVer.patch)
      );
    }
    return ver.major === rangeVer.major && ver.minor === rangeVer.minor && ver.patch >= rangeVer.patch;
  }

  if (range.startsWith('~')) {
    return ver.major === rangeVer.major && ver.minor === rangeVer.minor && ver.patch >= rangeVer.patch;
  }

  return ver.major === rangeVer.major && ver.minor === rangeVer.minor && ver.patch === rangeVer.patch;
}

/**
 * Plugin registry for searching, installing, and publishing plugins.
 */
export class PluginRegistry {
  private readonly config: MarketplaceRegistryConfig;
  private readonly registry: Map<string, PluginRegistryEntry> = new Map();
  private readonly installed: Map<string, { version: string; enabled: boolean }> = new Map();
  private readonly reviews: Map<string, PluginReview[]> = new Map();

  constructor(config: MarketplaceRegistryConfig) {
    if (!config.registryUrl) {
      throw new Error('registryUrl is required');
    }
    this.config = config;
  }

  /**
   * Search plugins by query, category, and other filters.
   */
  async search(options: PluginSearchOptions = {}): Promise<MarketplacePluginSearchResult> {
    const page = options.page ?? 1;
    const pageSize = options.pageSize ?? 20;

    if (page < 1) throw new Error('page must be >= 1');
    if (pageSize < 1 || pageSize > 100) throw new Error('pageSize must be between 1 and 100');

    let plugins = Array.from(this.registry.values());

    // Text search
    if (options.query) {
      const lower = options.query.toLowerCase();
      plugins = plugins.filter(
        (p) =>
          p.name.toLowerCase().includes(lower) ||
          p.displayName.toLowerCase().includes(lower) ||
          p.description.toLowerCase().includes(lower) ||
          p.keywords.some((k) => k.toLowerCase().includes(lower)),
      );
    }

    // Category filter
    if (options.category) {
      plugins = plugins.filter((p) => p.category === options.category);
    }

    // Verified filter
    if (options.verified !== undefined) {
      plugins = plugins.filter((p) => p.verified === options.verified);
    }

    // Compatibility filter
    if (options.compatibility?.pocketCore) {
      const coreVersion = options.compatibility.pocketCore;
      plugins = plugins.filter((p) => satisfiesSemver(coreVersion, p.compatibility.pocketCore));
    }
    if (options.compatibility?.platform) {
      const platform = options.compatibility.platform;
      plugins = plugins.filter(
        (p) => !p.compatibility.platforms || p.compatibility.platforms.includes(platform as CompatibilityMatrix['platforms'] extends (infer U)[] | undefined ? U : never),
      );
    }

    // Sort
    switch (options.sortBy) {
      case 'downloads':
        plugins.sort((a, b) => b.downloads - a.downloads);
        break;
      case 'rating':
        plugins.sort((a, b) => b.rating.average - a.rating.average);
        break;
      case 'newest':
        plugins.sort((a, b) => b.createdAt - a.createdAt);
        break;
      case 'updated':
        plugins.sort((a, b) => b.updatedAt - a.updatedAt);
        break;
      case 'relevance':
      default:
        plugins.sort((a, b) => b.downloads - a.downloads || b.rating.average - a.rating.average);
        break;
    }

    // Build facets from the full (filtered) set before pagination
    const categories: Record<string, number> = {};
    const platforms: Record<string, number> = {};
    for (const p of plugins) {
      categories[p.category] = (categories[p.category] ?? 0) + 1;
      if (p.compatibility.platforms) {
        for (const plat of p.compatibility.platforms) {
          platforms[plat] = (platforms[plat] ?? 0) + 1;
        }
      }
    }

    const total = plugins.length;
    const start = (page - 1) * pageSize;
    const paged = plugins.slice(start, start + pageSize);

    return { plugins: paged, total, page, pageSize, facets: { categories, platforms } };
  }

  /**
   * Get a single plugin by name.
   */
  async getPlugin(name: string): Promise<PluginRegistryEntry | null> {
    if (!name) throw new Error('Plugin name is required');
    return this.registry.get(name) ?? null;
  }

  /**
   * Get all versions for a plugin.
   */
  async getVersions(name: string): Promise<PluginVersionEntry[]> {
    if (!name) throw new Error('Plugin name is required');
    const entry = this.registry.get(name);
    if (!entry) throw new Error(`Plugin "${name}" not found`);
    return entry.versions;
  }

  /**
   * Install a plugin, optionally pinning a version.
   */
  async install(name: string, version?: string): Promise<PluginInstallResult> {
    const start = Date.now();
    if (!name) throw new Error('Plugin name is required');

    const entry = this.registry.get(name);
    if (!entry) throw new Error(`Plugin "${name}" not found in registry`);
    if (entry.deprecated) {
      // Allow install but with a warning
    }

    const targetVersion = version ?? entry.version;
    const versionEntry = entry.versions.find((v) => v.version === targetVersion);
    if (!versionEntry) {
      throw new Error(`Version "${targetVersion}" not found for plugin "${name}"`);
    }

    if (versionEntry.deprecated) {
      // Warning added below
    }

    const warnings: string[] = [];
    if (entry.deprecated) warnings.push(`Plugin "${name}" is deprecated`);
    if (versionEntry.deprecated) warnings.push(`Version "${targetVersion}" is deprecated`);

    // Check compatibility
    const compat = await this.checkCompatibility(name, targetVersion);
    if (!compat.compatible) {
      warnings.push(...compat.issues);
    }

    // Resolve dependencies from peer dependencies
    const dependencies: string[] = entry.compatibility.peerDependencies
      ? Object.keys(entry.compatibility.peerDependencies)
      : [];

    this.installed.set(name, { version: targetVersion, enabled: true });

    return {
      name,
      version: targetVersion,
      dependencies,
      success: true,
      duration: Date.now() - start,
      warnings,
    };
  }

  /**
   * Uninstall a plugin.
   */
  async uninstall(name: string): Promise<void> {
    if (!name) throw new Error('Plugin name is required');
    if (!this.installed.has(name)) {
      throw new Error(`Plugin "${name}" is not installed`);
    }
    this.installed.delete(name);
  }

  /**
   * Publish a plugin manifest to the registry.
   */
  async publish(
    manifest: PluginManifest,
    options?: PublishOptions,
  ): Promise<{ version: string; url: string }> {
    if (!manifest.name) throw new Error('Plugin manifest must have a name');
    if (!manifest.version) throw new Error('Plugin manifest must have a version');

    if (options?.dryRun) {
      return {
        version: manifest.version,
        url: `${this.config.registryUrl}/plugins/${manifest.name}/${manifest.version}`,
      };
    }

    const now = Date.now();
    const existing = this.registry.get(manifest.name);

    const versionEntry: PluginVersionEntry = {
      version: manifest.version,
      publishedAt: now,
      checksum: `sha256-${manifest.name}-${manifest.version}`,
      size: 0,
      pocketCoreVersion: manifest.pocketVersion,
    };

    if (existing) {
      if (existing.versions.some((v) => v.version === manifest.version)) {
        throw new Error(`Version "${manifest.version}" already exists for plugin "${manifest.name}"`);
      }
      existing.versions.push(versionEntry);
      existing.version = manifest.version;
      existing.updatedAt = now;
    } else {
      const entry: PluginRegistryEntry = {
        name: manifest.name,
        displayName: manifest.name,
        description: manifest.description,
        author: { name: manifest.author },
        version: manifest.version,
        versions: [versionEntry],
        repository: manifest.repository,
        homepage: manifest.homepage,
        license: manifest.license ?? 'MIT',
        keywords: manifest.keywords ?? [],
        category: (manifest.category as MarketplacePluginCategory) ?? 'other',
        downloads: 0,
        rating: { average: 0, count: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } },
        compatibility: {
          pocketCore: manifest.pocketVersion,
          peerDependencies: manifest.peerDependencies,
        },
        createdAt: now,
        updatedAt: now,
        verified: false,
        deprecated: false,
      };
      this.registry.set(manifest.name, entry);
    }

    return {
      version: manifest.version,
      url: `${this.config.registryUrl}/plugins/${manifest.name}/${manifest.version}`,
    };
  }

  /**
   * Check whether a specific plugin version is compatible with the current environment.
   */
  async checkCompatibility(
    name: string,
    version: string,
  ): Promise<{ compatible: boolean; issues: string[] }> {
    if (!name) throw new Error('Plugin name is required');
    if (!version) throw new Error('Version is required');

    const entry = this.registry.get(name);
    if (!entry) throw new Error(`Plugin "${name}" not found`);

    const versionEntry = entry.versions.find((v) => v.version === version);
    if (!versionEntry) throw new Error(`Version "${version}" not found for plugin "${name}"`);

    const issues: string[] = [];

    if (versionEntry.deprecated) {
      issues.push(`Version "${version}" is deprecated`);
    }

    return { compatible: issues.length === 0, issues };
  }

  /**
   * Get reviews for a plugin.
   */
  async getReviews(
    name: string,
    page = 1,
  ): Promise<{ reviews: PluginReview[]; total: number }> {
    if (!name) throw new Error('Plugin name is required');
    if (!this.registry.has(name)) throw new Error(`Plugin "${name}" not found`);

    const allReviews = this.reviews.get(name) ?? [];
    const pageSize = 10;
    const start = (page - 1) * pageSize;

    return {
      reviews: allReviews.slice(start, start + pageSize),
      total: allReviews.length,
    };
  }

  /**
   * Submit a review for a plugin.
   */
  async submitReview(
    name: string,
    review: Omit<PluginReview, 'createdAt' | 'helpful'>,
  ): Promise<void> {
    if (!name) throw new Error('Plugin name is required');
    if (!this.registry.has(name)) throw new Error(`Plugin "${name}" not found`);
    if (review.rating < 1 || review.rating > 5) throw new Error('Rating must be between 1 and 5');

    const fullReview: PluginReview = { ...review, createdAt: Date.now(), helpful: 0 };
    const existing = this.reviews.get(name) ?? [];
    existing.push(fullReview);
    this.reviews.set(name, existing);

    // Update plugin rating
    const entry = this.registry.get(name)!;
    const key = review.rating as 1 | 2 | 3 | 4 | 5;
    entry.rating.distribution[key] = (entry.rating.distribution[key] ?? 0) + 1;
    entry.rating.count += 1;
    const total = Object.entries(entry.rating.distribution).reduce(
      (sum, [star, count]) => sum + Number(star) * count,
      0,
    );
    entry.rating.average = total / entry.rating.count;
  }

  /**
   * List all currently installed plugins.
   */
  async listInstalled(): Promise<Array<{ name: string; version: string; enabled: boolean }>> {
    return Array.from(this.installed.entries()).map(([name, info]) => ({
      name,
      version: info.version,
      enabled: info.enabled,
    }));
  }
}

/**
 * Create a PluginRegistry instance.
 */
export function createPluginRegistry(config: MarketplaceRegistryConfig): PluginRegistry {
  return new PluginRegistry(config);
}
