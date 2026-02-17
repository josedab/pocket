/**
 * CloudSDK - Unified coordinator for zero-config cloud sync.
 *
 * Provides a high-level API that internally wires CloudSync,
 * CloudClient, and HealthMonitor into a single entry point.
 *
 * @module cloud-sdk
 */

import { BehaviorSubject, Subject, takeUntil, type Observable } from 'rxjs';
import { CloudClient } from './cloud-client.js';
import { CloudSync } from './cloud-sync.js';
import { HealthMonitor } from './health-monitor.js';
import type { CloudConfig, CloudEndpoint, CloudRegion } from './types.js';
import type { HealthStatus } from './health-monitor.js';

/**
 * Configuration for the CloudSDK.
 */
export interface CloudSDKConfig {
  /** API key for Pocket Cloud authentication */
  apiKey: string;
  /** Project identifier. Derived from API key if omitted. */
  projectId?: string;
  /** Cloud region for data residency. @default 'us-east-1' */
  region?: CloudRegion;
  /** Collections to sync */
  collections?: string[];
  /** Whether to automatically reconnect on connection loss. @default true */
  autoReconnect?: boolean;
}

/**
 * Connection status of the CloudSDK.
 */
export type CloudSDKStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Aggregated statistics from the CloudSDK.
 */
export interface CloudSDKStats {
  /** Current connection status */
  status: CloudSDKStatus;
  /** Health status from the monitor */
  health: HealthStatus;
  /** Number of reconnection attempts */
  reconnectAttempts: number;
  /** Timestamp of last successful connection */
  connectedSince: number | null;
}

/**
 * High-level unified coordinator for Pocket Cloud sync.
 *
 * Internally creates and wires CloudSync, CloudClient, and HealthMonitor
 * to provide a simple connect/disconnect interface with auto-reconnect.
 *
 * @example
 * ```typescript
 * import { createCloudSDK } from '@pocket/cloud';
 *
 * const sdk = createCloudSDK({ apiKey: 'pk_test_YOUR_API_KEY' });
 * await sdk.connect();
 *
 * sdk.status$.subscribe(status => console.log('Status:', status));
 *
 * await sdk.disconnect();
 * ```
 */
export class CloudSDK {
  private readonly config: CloudSDKConfig;
  private readonly destroy$ = new Subject<void>();
  private readonly status$$ = new BehaviorSubject<CloudSDKStatus>('disconnected');

  private client: CloudClient | null = null;
  private cloudSync: CloudSync | null = null;
  private healthMonitor: HealthMonitor | null = null;
  private reconnectAttempts = 0;
  private connectedSince: number | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /** Observable of the current connection status. */
  readonly status$: Observable<CloudSDKStatus>;

  constructor(config: CloudSDKConfig) {
    this.config = config;
    this.status$ = this.status$$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /**
   * Connect to the Pocket Cloud service.
   *
   * Creates the CloudClient, validates credentials, discovers
   * endpoints, and optionally starts the HealthMonitor.
   */
  async connect(): Promise<void> {
    if (this.status$$.getValue() === 'connected') {
      return;
    }

    this.status$$.next('connecting');

    try {
      const cloudConfig: CloudConfig = {
        projectId: this.config.projectId ?? this.config.apiKey,
        apiKey: this.config.apiKey,
        region: this.config.region,
      };

      this.client = new CloudClient(cloudConfig);

      // Validate API key
      const validation = await this.client.validateApiKey();
      if (!validation.valid) {
        throw new Error(`Invalid API key: ${validation.error ?? 'Unknown error'}`);
      }

      // Discover endpoint
      const endpoint: CloudEndpoint = await this.client.getEndpoint();

      // Create CloudSync
      this.cloudSync = new CloudSync(
        {
          projectId: cloudConfig.projectId,
          apiKey: this.config.apiKey,
          region: this.config.region,
          collections: this.config.collections,
        },
        this.client,
      );

      // Start health monitoring
      this.healthMonitor = new HealthMonitor(endpoint, { autoStart: true });

      this.reconnectAttempts = 0;
      this.connectedSince = Date.now();
      this.status$$.next('connected');
    } catch {
      this.status$$.next('error');
      this.connectedSince = null;

      if (this.config.autoReconnect !== false) {
        this.scheduleReconnect();
      }
    }
  }

  /**
   * Disconnect from the Pocket Cloud service and release resources.
   */
  async disconnect(): Promise<void> {
    this.clearReconnectTimer();

    if (this.healthMonitor) {
      this.healthMonitor.destroy();
      this.healthMonitor = null;
    }

    if (this.cloudSync) {
      this.cloudSync.destroy();
      this.cloudSync = null;
    }

    if (this.client) {
      this.client.destroy();
      this.client = null;
    }

    this.connectedSince = null;
    this.status$$.next('disconnected');
  }

  /**
   * Get aggregated statistics about the SDK state.
   */
  getStats(): CloudSDKStats {
    return {
      status: this.status$$.getValue(),
      health: this.healthMonitor?.getCurrentStatus() ?? 'unknown',
      reconnectAttempts: this.reconnectAttempts,
      connectedSince: this.connectedSince,
    };
  }

  /**
   * Whether the cloud connection is healthy.
   */
  isHealthy(): boolean {
    const status = this.status$$.getValue();
    if (status !== 'connected') return false;
    if (!this.healthMonitor) return false;
    const health = this.healthMonitor.getCurrentStatus();
    return health === 'healthy' || health === 'unknown';
  }

  /**
   * Permanently destroy the SDK and release all resources.
   */
  destroy(): void {
    void this.disconnect();
    this.destroy$.next();
    this.destroy$.complete();
    this.status$$.complete();
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();
    this.reconnectAttempts++;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30_000);
    this.reconnectTimer = setTimeout(() => {
      void this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

/**
 * Create a CloudSDK instance for zero-config cloud sync.
 *
 * @param config - SDK configuration
 * @returns A new CloudSDK instance
 *
 * @example
 * ```typescript
 * const sdk = createCloudSDK({
 *   apiKey: 'pk_test_YOUR_API_KEY',
 *   projectId: 'proj_abc123',
 *   region: 'eu-west-1',
 *   collections: ['todos'],
 * });
 *
 * await sdk.connect();
 * ```
 */
export function createCloudSDK(config: CloudSDKConfig): CloudSDK {
  return new CloudSDK(config);
}
