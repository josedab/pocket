/**
 * Types for the Pocket Cloud managed sync service.
 *
 * This module defines the configuration, project, and usage types
 * for integrating with Pocket Cloud.
 *
 * @module types
 */

import type { ConflictStrategy } from '@pocket/sync';

/**
 * Cloud service tiers with different capabilities and limits.
 *
 * - `'free'`: Limited operations per month, single region
 * - `'pro'`: Higher limits, multi-region support
 * - `'enterprise'`: Unlimited operations, dedicated infrastructure
 *
 * @see {@link CloudConfig.tier}
 */
export type CloudTier = 'free' | 'pro' | 'enterprise';

/**
 * Available cloud regions for data residency and latency optimization.
 *
 * @see {@link CloudConfig.region}
 */
export type CloudRegion =
  | 'us-east-1'
  | 'us-west-2'
  | 'eu-west-1'
  | 'eu-central-1'
  | 'ap-southeast-1'
  | 'ap-northeast-1';

/**
 * Status of a cloud sync connection.
 *
 * - `'connecting'`: Establishing connection to cloud service
 * - `'connected'`: Connected and syncing
 * - `'disconnected'`: Not connected to cloud service
 * - `'error'`: An error occurred
 * - `'quota-exceeded'`: Usage quota has been exceeded
 */
export type CloudStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error'
  | 'quota-exceeded';

/**
 * Configuration for connecting to Pocket Cloud.
 *
 * @example Minimal configuration
 * ```typescript
 * const config: CloudConfig = {
 *   projectId: 'proj_abc123',
 *   apiKey: 'pk_test_YOUR_API_KEY'
 * };
 * ```
 *
 * @example Full configuration
 * ```typescript
 * const config: CloudConfig = {
 *   projectId: 'proj_abc123',
 *   apiKey: 'pk_test_YOUR_API_KEY',
 *   region: 'eu-west-1',
 *   tier: 'pro',
 *   endpoint: 'https://custom-cloud.pocket-db.dev'
 * };
 * ```
 *
 * @see {@link createCloudSync}
 */
export interface CloudConfig {
  /** Unique project identifier from the Pocket Cloud dashboard */
  projectId: string;

  /**
   * API key for authentication. Prefixed with:
   * - `pk_live_` for production keys
   * - `pk_test_` for test/development keys
   */
  apiKey: string;

  /**
   * Cloud region for data storage and sync endpoints.
   * Defaults to the closest region based on latency.
   * @default 'us-east-1'
   */
  region?: CloudRegion;

  /**
   * Custom cloud endpoint URL. Overrides the default Pocket Cloud endpoint.
   * Useful for self-hosted or enterprise deployments.
   */
  endpoint?: string;

  /**
   * Service tier for the project. Determines rate limits and features.
   * @default 'free'
   */
  tier?: CloudTier;
}

/**
 * Extended sync options that combine cloud configuration with sync engine settings.
 *
 * @example
 * ```typescript
 * const options: CloudSyncOptions = {
 *   projectId: 'proj_abc123',
 *   apiKey: 'pk_test_YOUR_API_KEY',
 *   collections: ['todos', 'notes'],
 *   conflictStrategy: 'last-write-wins',
 *   useWebSocket: true
 * };
 * ```
 *
 * @see {@link CloudConfig}
 * @see {@link createCloudSync}
 */
export interface CloudSyncOptions extends CloudConfig {
  /** Collections to sync. Empty array syncs all collections with changes. */
  collections?: string[];

  /**
   * Sync direction:
   * - `'push'`: Only send local changes to server
   * - `'pull'`: Only receive changes from server
   * - `'both'`: Bidirectional sync (default)
   * @default 'both'
   */
  direction?: 'push' | 'pull' | 'both';

  /**
   * Strategy for resolving conflicts when same document modified locally and remotely.
   * @default 'last-write-wins'
   */
  conflictStrategy?: ConflictStrategy;

  /** Use WebSocket (true) or HTTP polling (false). @default true */
  useWebSocket?: boolean;

  /** Interval for pulling changes in ms (HTTP polling mode). @default 30000 */
  pullInterval?: number;

  /** Maximum changes per push/pull request. @default 100 */
  batchSize?: number;

  /** Automatically retry failed sync operations. @default true */
  autoRetry?: boolean;

  /** Maximum number of retry attempts before giving up. @default 5 */
  maxRetryAttempts?: number;

  /** Enable usage quota monitoring. @default true */
  monitorQuota?: boolean;
}

/**
 * Information about a cloud project.
 *
 * @see {@link CloudClient.getProjectInfo}
 */
export interface CloudProject {
  /** Unique project identifier */
  id: string;

  /** Human-readable project name */
  name: string;

  /** Service tier for the project */
  tier: CloudTier;

  /** Cloud region where data is stored */
  region: CloudRegion;

  /** Timestamp when the project was created */
  createdAt: number;

  /** Timestamp of the last sync operation */
  lastSyncAt: number | null;

  /** Whether the project is currently active */
  active: boolean;

  /** Maximum number of sync operations per month */
  maxOperationsPerMonth: number;

  /** Maximum storage in bytes */
  maxStorageBytes: number;
}

/**
 * Cloud usage statistics for a project.
 *
 * @see {@link CloudClient.getUsageStats}
 */
export interface CloudStats {
  /** Total sync operations this billing period */
  syncOperations: number;

  /** Maximum sync operations allowed this period */
  maxSyncOperations: number;

  /** Percentage of sync quota used (0-100) */
  syncQuotaUsedPercent: number;

  /** Total storage used in bytes */
  storageUsedBytes: number;

  /** Maximum storage allowed in bytes */
  maxStorageBytes: number;

  /** Percentage of storage quota used (0-100) */
  storageQuotaUsedPercent: number;

  /** Number of active connected clients */
  activeConnections: number;

  /** Maximum concurrent connections allowed */
  maxConnections: number;

  /** Timestamp of the last update to these stats */
  lastUpdatedAt: number;
}

/**
 * Usage metrics for monitoring cloud resource consumption.
 *
 * @see {@link CloudSync}
 */
export interface UsageMetrics {
  /** Sync operations consumed in current session */
  sessionOperations: number;

  /** Data transferred in bytes in current session */
  sessionBytesTransferred: number;

  /** Whether the quota warning threshold has been reached */
  quotaWarning: boolean;

  /** Whether the quota has been exceeded */
  quotaExceeded: boolean;

  /** Remaining sync operations in the billing period, or null if unknown */
  remainingOperations: number | null;
}

/**
 * Result of API key validation.
 *
 * @see {@link CloudClient.validateApiKey}
 */
export interface ApiKeyValidation {
  /** Whether the API key is valid */
  valid: boolean;

  /** The project ID associated with the key */
  projectId?: string;

  /** The key type: live or test */
  keyType?: 'live' | 'test';

  /** Permissions granted by the key */
  permissions?: string[];

  /** When the key expires, or null if it does not expire */
  expiresAt?: number | null;

  /** Error message if the key is invalid */
  error?: string;
}

/**
 * Endpoint discovery result from the cloud service.
 *
 * @see {@link CloudClient.getEndpoint}
 */
export interface CloudEndpoint {
  /** WebSocket sync endpoint URL */
  websocketUrl: string;

  /** HTTP sync endpoint URL */
  httpUrl: string;

  /** API endpoint URL */
  apiUrl: string;

  /** Cloud region of this endpoint */
  region: CloudRegion;

  /** Estimated latency in milliseconds */
  latencyMs?: number;
}

/**
 * Analytics data for a cloud project.
 *
 * @see {@link CloudDashboard.getAnalytics}
 */
export interface CloudAnalytics {
  /** Total sync operations over the time period */
  totalSyncOperations: number;

  /** Average sync operations per day */
  avgDailySyncOperations: number;

  /** Peak concurrent connections */
  peakConnections: number;

  /** Average sync latency in milliseconds */
  avgSyncLatencyMs: number;

  /** Total unique active users */
  activeUsers: number;

  /** Storage growth in bytes over the period */
  storageGrowthBytes: number;

  /** Conflict rate (conflicts / total operations) */
  conflictRate: number;

  /** Error rate (errors / total operations) */
  errorRate: number;

  /** Start of the analytics time period */
  periodStart: number;

  /** End of the analytics time period */
  periodEnd: number;
}

/**
 * API key management information.
 *
 * @see {@link CloudDashboard.createApiKey}
 */
export interface ApiKeyInfo {
  /** Unique key identifier */
  id: string;

  /** The API key value (only shown on creation) */
  key?: string;

  /** Human-readable name for the key */
  name: string;

  /** Key type: live or test */
  type: 'live' | 'test';

  /** Permissions granted to the key */
  permissions: string[];

  /** When the key was created */
  createdAt: number;

  /** When the key was last used */
  lastUsedAt: number | null;

  /** When the key expires, or null if it does not expire */
  expiresAt: number | null;

  /** Whether the key is currently active */
  active: boolean;
}

/**
 * Default Pocket Cloud API base URL.
 */
export const DEFAULT_CLOUD_ENDPOINT = 'https://cloud.pocket-db.dev';

/**
 * Default cloud region.
 */
export const DEFAULT_CLOUD_REGION: CloudRegion = 'us-east-1';

/**
 * API key prefix for live keys.
 */
export const API_KEY_LIVE_PREFIX = 'pk_live_';

/**
 * API key prefix for test keys.
 */
export const API_KEY_TEST_PREFIX = 'pk_test_';

/**
 * Minimum API key length (prefix + 16 characters).
 */
export const API_KEY_MIN_LENGTH = 24;

/**
 * Region-specific endpoint mapping.
 */
export const REGION_ENDPOINTS: Record<CloudRegion, string> = {
  'us-east-1': 'https://us-east-1.cloud.pocket-db.dev',
  'us-west-2': 'https://us-west-2.cloud.pocket-db.dev',
  'eu-west-1': 'https://eu-west-1.cloud.pocket-db.dev',
  'eu-central-1': 'https://eu-central-1.cloud.pocket-db.dev',
  'ap-southeast-1': 'https://ap-southeast-1.cloud.pocket-db.dev',
  'ap-northeast-1': 'https://ap-northeast-1.cloud.pocket-db.dev',
};

/**
 * Tier-specific limits.
 */
export const TIER_LIMITS: Record<CloudTier, { maxOperations: number; maxStorageBytes: number; maxConnections: number }> = {
  free: {
    maxOperations: 10_000,
    maxStorageBytes: 100 * 1024 * 1024, // 100 MB
    maxConnections: 5,
  },
  pro: {
    maxOperations: 1_000_000,
    maxStorageBytes: 10 * 1024 * 1024 * 1024, // 10 GB
    maxConnections: 100,
  },
  enterprise: {
    maxOperations: Infinity,
    maxStorageBytes: Infinity,
    maxConnections: Infinity,
  },
};
