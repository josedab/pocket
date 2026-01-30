/**
 * Auto-configuration for edge storage.
 *
 * Automatically detects the current runtime platform and creates
 * an appropriately configured storage adapter.
 *
 * @module @pocket/storage-edge
 */

/**
 * Supported runtime platforms.
 */
export type Platform = 'cloudflare' | 'deno' | 'vercel' | 'bun' | 'node';

/**
 * Options for auto-configured storage creation.
 */
export interface AutoConfigOptions {
  /** Override platform detection */
  platform?: Platform;
  /** Additional platform-specific configuration */
  config?: Record<string, unknown>;
}

/**
 * Recommended configuration for a platform.
 */
export interface PlatformConfig {
  /** Platform name */
  platform: Platform;
  /** Recommended storage adapter */
  storageAdapter: string;
  /** Recommended configuration values */
  config: Record<string, unknown>;
  /** Setup instructions */
  instructions: string[];
}

/**
 * Result of auto-configured storage creation.
 */
export interface AutoConfigResult {
  /** Detected or specified platform */
  platform: Platform;
  /** Storage adapter factory name */
  adapterFactory: string;
  /** Configuration used */
  config: Record<string, unknown>;
}

/**
 * Detect the current runtime platform.
 *
 * Checks for platform-specific globals and environment variables
 * to determine which edge runtime is in use.
 *
 * @returns The detected platform identifier
 */
export function detectPlatform(): Platform {
  // Check for Cloudflare Workers
  if (typeof globalThis !== 'undefined' && 'caches' in globalThis && typeof (globalThis as Record<string, unknown>).HTMLRewriter === 'function') {
    return 'cloudflare';
  }

  // Check for Deno
  if (typeof globalThis !== 'undefined' && 'Deno' in globalThis) {
    return 'deno';
  }

  // Check for Bun
  if (typeof globalThis !== 'undefined' && 'Bun' in globalThis) {
    return 'bun';
  }

  // Check for Vercel Edge
  if (typeof process !== 'undefined' && process.env?.VERCEL === '1') {
    return 'vercel';
  }

  // Default to Node.js
  return 'node';
}

/**
 * Create an auto-configured storage adapter for the detected platform.
 *
 * Detects the current runtime and returns adapter configuration
 * for the appropriate storage backend.
 *
 * @param options - Optional overrides for platform and config
 * @returns Configuration result with adapter details
 */
export function createAutoConfiguredStorage(options?: AutoConfigOptions): AutoConfigResult {
  const platform = options?.platform ?? detectPlatform();
  const userConfig = options?.config ?? {};

  switch (platform) {
    case 'cloudflare':
      return {
        platform,
        adapterFactory: 'createCloudflareKVStorage',
        config: { namespace: userConfig.namespace ?? 'POCKET_KV', ...userConfig },
      };

    case 'deno':
      return {
        platform,
        adapterFactory: 'createDenoKVStorage',
        config: { path: userConfig.path, ...userConfig },
      };

    case 'vercel':
      return {
        platform,
        adapterFactory: 'createVercelKVStorage',
        config: {
          url: userConfig.url ?? process.env?.KV_REST_API_URL ?? '',
          token: userConfig.token ?? process.env?.KV_REST_API_TOKEN ?? '',
          ...userConfig,
        },
      };

    case 'bun':
      return {
        platform,
        adapterFactory: 'createBunSQLiteStorage',
        config: { filename: userConfig.filename ?? 'pocket.db', ...userConfig },
      };

    case 'node':
    default:
      return {
        platform: 'node',
        adapterFactory: 'createSQLiteStorage',
        config: { filename: userConfig.filename ?? 'pocket.db', ...userConfig },
      };
  }
}

/**
 * Get recommended configuration for a specific platform.
 *
 * @param platform - The target platform
 * @returns Recommended configuration and setup instructions
 */
export function getRecommendedConfig(platform: Platform): PlatformConfig {
  switch (platform) {
    case 'cloudflare':
      return {
        platform,
        storageAdapter: 'createCloudflareKVStorage',
        config: {
          namespace: 'POCKET_KV',
          durableObjects: true,
        },
        instructions: [
          'Add KV namespace to wrangler.toml',
          'Configure Durable Objects for strong consistency',
          'Use wrangler deploy to publish',
        ],
      };

    case 'deno':
      return {
        platform,
        storageAdapter: 'createDenoKVStorage',
        config: {},
        instructions: [
          'Deno KV is built-in — no additional configuration needed',
          'Deploy to Deno Deploy for production use',
          'Use --allow-net and --allow-read flags',
        ],
      };

    case 'vercel':
      return {
        platform,
        storageAdapter: 'createVercelKVStorage',
        config: {
          url: 'process.env.KV_REST_API_URL',
          token: 'process.env.KV_REST_API_TOKEN',
        },
        instructions: [
          'Create a Vercel KV store in the dashboard',
          'Link environment variables to your project',
          'Deploy with vercel deploy',
        ],
      };

    case 'bun':
      return {
        platform,
        storageAdapter: 'createBunSQLiteStorage',
        config: {
          filename: 'pocket.db',
        },
        instructions: [
          'Bun SQLite is built-in — no additional packages needed',
          'Use bun run to start the server',
          'Data persists in the SQLite file',
        ],
      };

    case 'node':
    default:
      return {
        platform: 'node',
        storageAdapter: 'createSQLiteStorage',
        config: {
          filename: 'pocket.db',
        },
        instructions: [
          'Install better-sqlite3: npm install better-sqlite3',
          'Use the SQLite storage adapter from @pocket/storage-sqlite',
          'Data persists in the SQLite file',
        ],
      };
  }
}

/**
 * Create an auto-config helper with all detection and configuration utilities.
 */
export function createAutoConfig() {
  return {
    detectPlatform,
    createAutoConfiguredStorage,
    getRecommendedConfig,
  };
}
