/**
 * CloudDashboard - Project management API for Pocket Cloud.
 *
 * Provides a programmatic interface for managing cloud projects,
 * API keys, and viewing analytics.
 *
 * @module cloud-dashboard
 */

import { ConnectionError } from '@pocket/core';
import type {
  ApiKeyInfo,
  CloudAnalytics,
  CloudConfig,
  CloudProject,
  CloudRegion,
  CloudTier,
} from './types.js';
import {
  DEFAULT_CLOUD_ENDPOINT,
  DEFAULT_CLOUD_REGION,
  REGION_ENDPOINTS,
} from './types.js';

/**
 * Options for creating a new cloud project.
 *
 * @see {@link CloudDashboard.createProject}
 */
export interface CreateProjectOptions {
  /** Human-readable project name */
  name: string;

  /** Cloud region for data storage */
  region?: CloudRegion;

  /** Service tier for the project */
  tier?: CloudTier;

  /** Optional metadata tags */
  tags?: Record<string, string>;
}

/**
 * Options for creating a new API key.
 *
 * @see {@link CloudDashboard.createApiKey}
 */
export interface CreateApiKeyOptions {
  /** Human-readable name for the key */
  name: string;

  /** Key type: live or test */
  type: 'live' | 'test';

  /** Permissions to grant (e.g., ['sync:read', 'sync:write']) */
  permissions?: string[];

  /** Expiration time in milliseconds from now, or null for no expiration */
  expiresInMs?: number | null;
}

/**
 * Options for querying analytics.
 *
 * @see {@link CloudDashboard.getAnalytics}
 */
export interface AnalyticsQueryOptions {
  /** Start of the time period (Unix timestamp) */
  from?: number;

  /** End of the time period (Unix timestamp) */
  to?: number;

  /** Granularity of the data: hourly, daily, or monthly */
  granularity?: 'hourly' | 'daily' | 'monthly';
}

/**
 * Dashboard API for managing Pocket Cloud projects.
 *
 * The CloudDashboard provides a programmatic interface for:
 * - Listing, creating, and deleting projects
 * - Viewing sync analytics and metrics
 * - Managing API keys
 *
 * @example Basic usage
 * ```typescript
 * import { CloudDashboard } from '@pocket/cloud';
 *
 * const dashboard = new CloudDashboard({
 *   projectId: 'proj_abc123',
 *   apiKey: 'pk_test_YOUR_API_KEY'
 * });
 *
 * // List all projects
 * const projects = await dashboard.listProjects();
 * for (const project of projects) {
 *   console.log(`${project.name} (${project.tier}) - ${project.region}`);
 * }
 *
 * // Get analytics
 * const analytics = await dashboard.getAnalytics({
 *   from: Date.now() - 7 * 24 * 60 * 60 * 1000, // Last 7 days
 *   granularity: 'daily'
 * });
 * console.log(`Total sync ops: ${analytics.totalSyncOperations}`);
 * ```
 *
 * @see {@link CloudConfig}
 * @see {@link createCloudDashboard}
 */
export class CloudDashboard {
  private readonly config: CloudConfig;
  private readonly baseUrl: string;

  constructor(config: CloudConfig) {
    this.config = config;
    this.baseUrl = this.resolveBaseUrl();
  }

  /**
   * List all projects accessible with the current API key.
   *
   * @returns Array of cloud projects
   * @throws {ConnectionError} If the request fails
   *
   * @example
   * ```typescript
   * const projects = await dashboard.listProjects();
   * console.log(`Found ${projects.length} projects`);
   * for (const project of projects) {
   *   console.log(`  - ${project.name} (${project.id})`);
   * }
   * ```
   */
  async listProjects(): Promise<CloudProject[]> {
    try {
      const response = await this.fetch<{ projects: CloudProject[] }>(
        '/v1/projects'
      );
      return response.projects;
    } catch (error) {
      throw new ConnectionError(
        'POCKET_C501',
        'Failed to list cloud projects',
        {},
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Create a new cloud project.
   *
   * @param options - Project creation options
   * @returns The newly created project
   * @throws {ConnectionError} If creation fails
   *
   * @example
   * ```typescript
   * const project = await dashboard.createProject({
   *   name: 'My New App',
   *   region: 'eu-west-1',
   *   tier: 'pro'
   * });
   * console.log('Created project:', project.id);
   * ```
   */
  async createProject(options: CreateProjectOptions): Promise<CloudProject> {
    try {
      const project = await this.fetch<CloudProject>(
        '/v1/projects',
        {
          method: 'POST',
          body: JSON.stringify({
            name: options.name,
            region: options.region ?? DEFAULT_CLOUD_REGION,
            tier: options.tier ?? 'free',
            tags: options.tags,
          }),
        }
      );
      return project;
    } catch (error) {
      throw new ConnectionError(
        'POCKET_C501',
        `Failed to create cloud project "${options.name}"`,
        { name: options.name, region: options.region },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Delete a cloud project.
   *
   * This permanently deletes the project and all associated data.
   * This action cannot be undone.
   *
   * @param projectId - The project ID to delete
   * @throws {ConnectionError} If deletion fails
   *
   * @example
   * ```typescript
   * await dashboard.deleteProject('proj_abc123');
   * console.log('Project deleted');
   * ```
   */
  async deleteProject(projectId: string): Promise<void> {
    try {
      await this.fetch<{ deleted: boolean }>(
        `/v1/projects/${projectId}`,
        { method: 'DELETE' }
      );
    } catch (error) {
      throw new ConnectionError(
        'POCKET_C501',
        `Failed to delete cloud project "${projectId}"`,
        { projectId },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Get analytics data for the current project.
   *
   * Returns sync metrics, active users, storage usage, and
   * performance data for the specified time period.
   *
   * @param options - Analytics query options (time range, granularity)
   * @returns Analytics data for the project
   * @throws {ConnectionError} If the request fails
   *
   * @example
   * ```typescript
   * // Last 30 days analytics
   * const analytics = await dashboard.getAnalytics({
   *   from: Date.now() - 30 * 24 * 60 * 60 * 1000,
   *   granularity: 'daily'
   * });
   *
   * console.log(`Total sync ops: ${analytics.totalSyncOperations}`);
   * console.log(`Active users: ${analytics.activeUsers}`);
   * console.log(`Avg latency: ${analytics.avgSyncLatencyMs}ms`);
   * console.log(`Conflict rate: ${(analytics.conflictRate * 100).toFixed(1)}%`);
   * ```
   */
  async getAnalytics(options: AnalyticsQueryOptions = {}): Promise<CloudAnalytics> {
    const params = new URLSearchParams();
    if (options.from !== undefined) {
      params.set('from', options.from.toString());
    }
    if (options.to !== undefined) {
      params.set('to', options.to.toString());
    }
    if (options.granularity) {
      params.set('granularity', options.granularity);
    }

    const queryString = params.toString();
    const path = `/v1/projects/${this.config.projectId}/analytics${queryString ? `?${queryString}` : ''}`;

    try {
      const analytics = await this.fetch<CloudAnalytics>(path);
      return analytics;
    } catch (error) {
      throw new ConnectionError(
        'POCKET_C501',
        `Failed to fetch analytics for project "${this.config.projectId}"`,
        { projectId: this.config.projectId, ...options },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * List API keys for the current project.
   *
   * @returns Array of API key information (keys are partially masked)
   * @throws {ConnectionError} If the request fails
   *
   * @example
   * ```typescript
   * const keys = await dashboard.listApiKeys();
   * for (const key of keys) {
   *   console.log(`${key.name} (${key.type}) - Active: ${key.active}`);
   * }
   * ```
   */
  async listApiKeys(): Promise<ApiKeyInfo[]> {
    try {
      const response = await this.fetch<{ keys: ApiKeyInfo[] }>(
        `/v1/projects/${this.config.projectId}/keys`
      );
      return response.keys;
    } catch (error) {
      throw new ConnectionError(
        'POCKET_C501',
        `Failed to list API keys for project "${this.config.projectId}"`,
        { projectId: this.config.projectId },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Create a new API key for the current project.
   *
   * The full key value is only returned once, at creation time.
   * Store it securely.
   *
   * @param options - Key creation options
   * @returns The created key information (including the full key value)
   * @throws {ConnectionError} If creation fails
   *
   * @example
   * ```typescript
   * const key = await dashboard.createApiKey({
   *   name: 'Production Key',
   *   type: 'live',
   *   permissions: ['sync:read', 'sync:write']
   * });
   *
   * console.log('New API key:', key.key); // Only shown once!
   * console.log('Key ID:', key.id);
   * ```
   */
  async createApiKey(options: CreateApiKeyOptions): Promise<ApiKeyInfo> {
    try {
      const key = await this.fetch<ApiKeyInfo>(
        `/v1/projects/${this.config.projectId}/keys`,
        {
          method: 'POST',
          body: JSON.stringify({
            name: options.name,
            type: options.type,
            permissions: options.permissions ?? ['sync:read', 'sync:write'],
            expiresInMs: options.expiresInMs ?? null,
          }),
        }
      );
      return key;
    } catch (error) {
      throw new ConnectionError(
        'POCKET_C501',
        `Failed to create API key "${options.name}"`,
        { projectId: this.config.projectId, name: options.name },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Revoke (deactivate) an API key.
   *
   * Once revoked, the key can no longer be used for authentication.
   * This action cannot be undone.
   *
   * @param keyId - The key ID to revoke
   * @throws {ConnectionError} If revocation fails
   *
   * @example
   * ```typescript
   * await dashboard.revokeApiKey('key_xyz789');
   * console.log('API key revoked');
   * ```
   */
  async revokeApiKey(keyId: string): Promise<void> {
    try {
      await this.fetch<{ revoked: boolean }>(
        `/v1/projects/${this.config.projectId}/keys/${keyId}`,
        { method: 'DELETE' }
      );
    } catch (error) {
      throw new ConnectionError(
        'POCKET_C501',
        `Failed to revoke API key "${keyId}"`,
        { projectId: this.config.projectId, keyId },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Make an authenticated HTTP request to the cloud API.
   */
  private async fetch<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.apiKey}`,
      'X-Pocket-Project': this.config.projectId,
      ...(options.headers as Record<string, string> | undefined),
    };

    const response = await globalThis.fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');
      throw new ConnectionError(
        'POCKET_C501',
        `Cloud API request failed: ${response.status} ${response.statusText} - ${errorBody}`,
        {
          url,
          status: response.status,
          statusText: response.statusText,
        }
      );
    }

    return response.json() as Promise<T>;
  }

  /**
   * Resolve the base URL from config, region, or default.
   */
  private resolveBaseUrl(): string {
    if (this.config.endpoint) {
      return this.config.endpoint.replace(/\/$/, '');
    }

    const region = this.config.region ?? DEFAULT_CLOUD_REGION;
    const regionEndpoint = REGION_ENDPOINTS[region];
    if (regionEndpoint) {
      return regionEndpoint;
    }

    return DEFAULT_CLOUD_ENDPOINT;
  }
}

/**
 * Factory function to create a CloudDashboard instance.
 *
 * @param config - Cloud configuration with project ID and API key
 * @returns A new CloudDashboard instance
 *
 * @example
 * ```typescript
 * const dashboard = createCloudDashboard({
 *   projectId: 'proj_abc123',
 *   apiKey: 'pk_test_YOUR_API_KEY'
 * });
 *
 * const projects = await dashboard.listProjects();
 * ```
 *
 * @see {@link CloudDashboard}
 */
export function createCloudDashboard(config: CloudConfig): CloudDashboard {
  return new CloudDashboard(config);
}
