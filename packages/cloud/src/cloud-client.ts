/**
 * CloudClient - HTTP client for Pocket Cloud API.
 *
 * Handles authentication, project management, and usage tracking
 * against the Pocket Cloud managed service.
 *
 * @module cloud-client
 */

import { ConnectionError } from '@pocket/core';
import { BehaviorSubject, type Observable } from 'rxjs';
import type {
  ApiKeyValidation,
  CloudConfig,
  CloudEndpoint,
  CloudProject,
  CloudStats,
  CloudStatus,
} from './types.js';
import {
  API_KEY_LIVE_PREFIX,
  API_KEY_MIN_LENGTH,
  API_KEY_TEST_PREFIX,
  DEFAULT_CLOUD_ENDPOINT,
  DEFAULT_CLOUD_REGION,
  REGION_ENDPOINTS,
} from './types.js';

/**
 * HTTP client for interacting with the Pocket Cloud API.
 *
 * The CloudClient handles:
 * - API key validation and authentication
 * - Project metadata retrieval
 * - Usage statistics and quota monitoring
 * - Endpoint discovery for optimal sync routing
 *
 * @example Basic usage
 * ```typescript
 * const client = new CloudClient({
 *   projectId: 'proj_abc123',
 *   apiKey: 'pk_live_xxxxxxxx'
 * });
 *
 * // Validate the API key
 * const validation = await client.validateApiKey();
 * if (validation.valid) {
 *   console.log('API key is valid for project:', validation.projectId);
 * }
 *
 * // Get project info
 * const project = await client.getProjectInfo();
 * console.log('Project:', project.name, 'Tier:', project.tier);
 *
 * // Check usage
 * const stats = await client.getUsageStats();
 * console.log(`Usage: ${stats.syncQuotaUsedPercent}%`);
 * ```
 *
 * @see {@link CloudConfig}
 * @see {@link createCloudClient}
 */
export class CloudClient {
  private readonly config: CloudConfig;
  private readonly baseUrl: string;
  private readonly status$ = new BehaviorSubject<CloudStatus>('disconnected');

  constructor(config: CloudConfig) {
    this.config = config;
    this.baseUrl = this.resolveBaseUrl();
  }

  /**
   * Validate the API key format and check with the cloud server.
   *
   * Performs both local format validation and server-side validation
   * to ensure the key is valid and has appropriate permissions.
   *
   * @returns Validation result with key details
   * @throws {ConnectionError} If the server cannot be reached
   *
   * @example
   * ```typescript
   * const result = await client.validateApiKey();
   * if (!result.valid) {
   *   console.error('Invalid API key:', result.error);
   *   return;
   * }
   * console.log('Key type:', result.keyType);
   * console.log('Permissions:', result.permissions);
   * ```
   */
  async validateApiKey(): Promise<ApiKeyValidation> {
    // Local format validation first
    const localValidation = this.validateApiKeyFormat(this.config.apiKey);
    if (!localValidation.valid) {
      return localValidation;
    }

    // Server-side validation
    try {
      const response = await this.fetch<ApiKeyValidation>(
        '/v1/auth/validate',
        { method: 'POST' }
      );
      return response;
    } catch (error) {
      throw new ConnectionError(
        'POCKET_C501',
        'Failed to validate API key with cloud service',
        { projectId: this.config.projectId },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Fetch project metadata from the cloud service.
   *
   * Returns information about the project including tier, region,
   * limits, and activity.
   *
   * @returns Project information
   * @throws {ConnectionError} If the request fails
   *
   * @example
   * ```typescript
   * const project = await client.getProjectInfo();
   * console.log(`Project: ${project.name}`);
   * console.log(`Tier: ${project.tier}`);
   * console.log(`Region: ${project.region}`);
   * console.log(`Active: ${project.active}`);
   * ```
   */
  async getProjectInfo(): Promise<CloudProject> {
    try {
      this.status$.next('connecting');
      const project = await this.fetch<CloudProject>(
        `/v1/projects/${this.config.projectId}`
      );
      this.status$.next('connected');
      return project;
    } catch (error) {
      this.status$.next('error');
      throw new ConnectionError(
        'POCKET_C501',
        `Failed to fetch project info for "${this.config.projectId}"`,
        { projectId: this.config.projectId },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Get usage statistics for the project.
   *
   * Returns current sync operation counts, storage usage,
   * and quota information for the billing period.
   *
   * @returns Usage statistics
   * @throws {ConnectionError} If the request fails
   *
   * @example
   * ```typescript
   * const stats = await client.getUsageStats();
   * console.log(`Sync operations: ${stats.syncOperations}/${stats.maxSyncOperations}`);
   * console.log(`Storage: ${(stats.storageUsedBytes / 1024 / 1024).toFixed(1)} MB`);
   *
   * if (stats.syncQuotaUsedPercent > 80) {
   *   console.warn('Approaching sync quota limit!');
   * }
   * ```
   */
  async getUsageStats(): Promise<CloudStats> {
    try {
      const stats = await this.fetch<CloudStats>(
        `/v1/projects/${this.config.projectId}/usage`
      );

      // Check quota status
      if (stats.syncQuotaUsedPercent >= 100 || stats.storageQuotaUsedPercent >= 100) {
        this.status$.next('quota-exceeded');
      }

      return stats;
    } catch (error) {
      throw new ConnectionError(
        'POCKET_C501',
        `Failed to fetch usage stats for "${this.config.projectId}"`,
        { projectId: this.config.projectId },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Discover the best sync endpoint for this project.
   *
   * Returns the regional endpoint URLs for WebSocket and HTTP sync,
   * based on the configured region or automatic discovery.
   *
   * @returns Endpoint information with WebSocket and HTTP URLs
   * @throws {ConnectionError} If endpoint discovery fails
   *
   * @example
   * ```typescript
   * const endpoint = await client.getEndpoint();
   * console.log('WebSocket URL:', endpoint.websocketUrl);
   * console.log('HTTP URL:', endpoint.httpUrl);
   * console.log('Region:', endpoint.region);
   * ```
   */
  async getEndpoint(): Promise<CloudEndpoint> {
    try {
      const endpoint = await this.fetch<CloudEndpoint>(
        `/v1/projects/${this.config.projectId}/endpoint`
      );
      return endpoint;
    } catch {
      // Fall back to constructing endpoint from region
      const region = this.config.region ?? DEFAULT_CLOUD_REGION;
      const regionBase = REGION_ENDPOINTS[region] ?? REGION_ENDPOINTS[DEFAULT_CLOUD_REGION];

      return {
        websocketUrl: regionBase.replace('https://', 'wss://') + `/sync/${this.config.projectId}`,
        httpUrl: regionBase + `/sync/${this.config.projectId}`,
        apiUrl: regionBase + '/v1',
        region,
      };
    }
  }

  /**
   * Get an observable of the client's connection status.
   *
   * @returns Observable that emits status changes
   *
   * @example
   * ```typescript
   * client.getStatus().subscribe(status => {
   *   console.log('Cloud client status:', status);
   * });
   * ```
   */
  getStatus(): Observable<CloudStatus> {
    return this.status$.asObservable();
  }

  /**
   * Get the current status value synchronously.
   *
   * @returns Current cloud status
   */
  getCurrentStatus(): CloudStatus {
    return this.status$.getValue();
  }

  /**
   * Get the resolved base URL for API calls.
   *
   * @returns The base API URL
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    this.status$.complete();
  }

  /**
   * Validate API key format locally without server call.
   */
  private validateApiKeyFormat(apiKey: string): ApiKeyValidation {
    if (!apiKey || apiKey.length < API_KEY_MIN_LENGTH) {
      return {
        valid: false,
        error: `API key must be at least ${API_KEY_MIN_LENGTH} characters long`,
      };
    }

    const isLiveKey = apiKey.startsWith(API_KEY_LIVE_PREFIX);
    const isTestKey = apiKey.startsWith(API_KEY_TEST_PREFIX);

    if (!isLiveKey && !isTestKey) {
      return {
        valid: false,
        error: `API key must start with "${API_KEY_LIVE_PREFIX}" or "${API_KEY_TEST_PREFIX}"`,
      };
    }

    return {
      valid: true,
      keyType: isLiveKey ? 'live' : 'test',
    };
  }

  /**
   * Resolve the base URL from config, region, or default.
   */
  private resolveBaseUrl(): string {
    // Custom endpoint takes priority
    if (this.config.endpoint) {
      return this.config.endpoint.replace(/\/$/, '');
    }

    // Region-specific endpoint
    const region = this.config.region ?? DEFAULT_CLOUD_REGION;
    const regionEndpoint = REGION_ENDPOINTS[region];
    if (regionEndpoint) {
      return regionEndpoint;
    }

    // Default endpoint
    return DEFAULT_CLOUD_ENDPOINT;
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
}

/**
 * Factory function to create a CloudClient instance.
 *
 * @param config - Cloud configuration with project ID and API key
 * @returns A new CloudClient instance
 *
 * @example
 * ```typescript
 * const client = createCloudClient({
 *   projectId: 'proj_abc123',
 *   apiKey: 'pk_live_xxxxxxxx'
 * });
 *
 * const project = await client.getProjectInfo();
 * console.log('Project:', project.name);
 * ```
 *
 * @see {@link CloudClient}
 */
export function createCloudClient(config: CloudConfig): CloudClient {
  return new CloudClient(config);
}
