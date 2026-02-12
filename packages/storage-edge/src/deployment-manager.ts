/**
 * Deployment Manager - Edge deployment configuration and validation.
 *
 * Provides deployment configuration generation and resource estimation
 * for edge runtime platforms.
 *
 * @module @pocket/storage-edge
 */

/**
 * Supported edge deployment providers.
 */
export type DeploymentProvider = 'cloudflare' | 'deno' | 'vercel' | 'bun';

/**
 * Configuration for the deployment manager.
 */
export interface DeploymentManagerConfig {
  /** Target deployment provider */
  provider: DeploymentProvider;
  /** Target deployment region */
  region?: string;
  /** Project name for the deployment */
  projectName: string;
}

/**
 * Result of configuration validation.
 */
export interface ValidationResult {
  /** Whether the configuration is valid */
  valid: boolean;
  /** Validation errors that must be fixed */
  errors: string[];
  /** Non-blocking warnings */
  warnings: string[];
}

/**
 * Generated deployment configuration.
 */
export interface DeploymentConfig {
  /** Target provider name */
  provider: string;
  /** Deployment region */
  region: string;
  /** Environment variables to set */
  environment: Record<string, string>;
  /** Sync server configuration */
  syncServerConfig: Record<string, unknown>;
}

/**
 * Information about a deployment provider.
 */
export interface ProviderInfo {
  /** Display name */
  name: string;
  /** Features supported by this provider */
  supportedFeatures: string[];
  /** Available deployment regions */
  regions: string[];
  /** Known limitations */
  limitations: string[];
}

/**
 * Estimated resource usage for a deployment.
 */
export interface ResourceEstimate {
  /** Estimated storage in MB */
  estimatedStorageMB: number;
  /** Estimated monthly bandwidth in MB */
  estimatedBandwidthMB: number;
  /** Estimated monthly cost as a formatted string */
  estimatedCostPerMonth: string;
  /** Pricing tier */
  tier: string;
}

/**
 * Deployment manager interface.
 */
export interface DeploymentManager {
  /** Validate the current configuration */
  validateConfig(): ValidationResult;
  /** Generate deployment configuration */
  generateConfig(): DeploymentConfig;
  /** Get information about the configured provider */
  getProviderInfo(): ProviderInfo;
  /** Estimate resources for a given document count */
  estimateResources(documentCount: number): ResourceEstimate;
}

const PROVIDER_INFO: Record<DeploymentProvider, ProviderInfo> = {
  cloudflare: {
    name: 'Cloudflare Workers',
    supportedFeatures: [
      'kv-storage',
      'durable-objects',
      'websockets',
      'd1-database',
      'edge-caching',
    ],
    regions: ['auto', 'wnam', 'enam', 'weur', 'eeur', 'apac'],
    limitations: ['128MB memory limit', '30s CPU time limit', '25MB script size'],
  },
  deno: {
    name: 'Deno Deploy',
    supportedFeatures: ['kv-storage', 'websockets', 'npm-compatibility', 'built-in-kv'],
    regions: ['auto', 'us-east', 'us-west', 'europe', 'asia'],
    limitations: ['512MB memory limit', '50ms CPU time per request', 'Limited npm support'],
  },
  vercel: {
    name: 'Vercel Edge Functions',
    supportedFeatures: ['kv-storage', 'edge-config', 'isr', 'middleware'],
    regions: ['auto', 'iad1', 'sfo1', 'cdg1', 'hnd1', 'sin1'],
    limitations: ['128MB memory limit', '30s execution limit', 'No persistent connections'],
  },
  bun: {
    name: 'Bun Runtime',
    supportedFeatures: ['sqlite-storage', 'websockets', 'file-io', 'native-modules'],
    regions: ['self-hosted'],
    limitations: [
      'Self-hosted only',
      'Requires server management',
      'No built-in global distribution',
    ],
  },
};

const DEFAULT_REGIONS: Record<DeploymentProvider, string> = {
  cloudflare: 'auto',
  deno: 'auto',
  vercel: 'auto',
  bun: 'self-hosted',
};

/**
 * Create a deployment manager for edge deployments.
 *
 * @param config - Deployment configuration
 * @returns A DeploymentManager instance
 */
export function createDeploymentManager(config: DeploymentManagerConfig): DeploymentManager {
  const { provider, region, projectName } = config;

  function validateConfig(): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!projectName || projectName.trim().length === 0) {
      errors.push('projectName is required and cannot be empty');
    } else if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(projectName) && projectName.length > 1) {
      warnings.push('projectName should use lowercase alphanumeric characters and hyphens');
    }

    const info = PROVIDER_INFO[provider];
    if (region && !info.regions.includes(region)) {
      errors.push(
        `Region "${region}" is not supported by ${info.name}. Available: ${info.regions.join(', ')}`
      );
    }

    if (provider === 'bun') {
      warnings.push('Bun deployments are self-hosted and require manual server management');
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  function generateConfig(): DeploymentConfig {
    const resolvedRegion = region ?? DEFAULT_REGIONS[provider];

    const environment: Record<string, string> = {
      POCKET_PROVIDER: provider,
      POCKET_PROJECT: projectName,
      POCKET_REGION: resolvedRegion,
    };

    const syncServerConfig: Record<string, unknown> = {
      conflictStrategy: 'last-write-wins',
      maxChangesPerRequest: 100,
    };

    switch (provider) {
      case 'cloudflare':
        environment.POCKET_KV_NAMESPACE = `POCKET_${projectName.toUpperCase().replace(/-/g, '_')}`;
        syncServerConfig.durableObjects = true;
        break;
      case 'deno':
        syncServerConfig.kvPath = undefined;
        break;
      case 'vercel':
        environment.KV_REST_API_URL = '';
        environment.KV_REST_API_TOKEN = '';
        break;
      case 'bun':
        syncServerConfig.sqliteFilename = `${projectName}.db`;
        break;
    }

    return { provider, region: resolvedRegion, environment, syncServerConfig };
  }

  function getProviderInfo(): ProviderInfo {
    return { ...PROVIDER_INFO[provider] };
  }

  function estimateResources(documentCount: number): ResourceEstimate {
    // ~1KB average per document
    const avgDocSizeKB = 1;
    const storageMB = (documentCount * avgDocSizeKB) / 1024;
    // Assume ~10 reads per document per month, ~50KB per request
    const bandwidthMB = (documentCount * 10 * 50) / 1024;

    let costPerMonth: string;
    let tier: string;

    if (documentCount <= 1_000) {
      tier = 'free';
      costPerMonth = '$0 (free tier)';
    } else if (documentCount <= 100_000) {
      tier = 'starter';
      costPerMonth = '$5-25/month';
    } else if (documentCount <= 1_000_000) {
      tier = 'pro';
      costPerMonth = '$25-100/month';
    } else {
      tier = 'enterprise';
      costPerMonth = '$100+/month';
    }

    return {
      estimatedStorageMB: Math.round(storageMB * 100) / 100,
      estimatedBandwidthMB: Math.round(bandwidthMB * 100) / 100,
      estimatedCostPerMonth: costPerMonth,
      tier,
    };
  }

  return { validateConfig, generateConfig, getProviderInfo, estimateResources };
}
