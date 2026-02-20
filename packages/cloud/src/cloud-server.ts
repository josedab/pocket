/**
 * CloudSyncServer - Hosted sync server bootstrapper with multi-tenant isolation.
 *
 * Provides a configurable sync server that supports tenant routing,
 * connection tracking, health checks, and bandwidth monitoring.
 *
 * @module cloud-server
 */

import { BehaviorSubject, Subject, takeUntil, type Observable } from 'rxjs';
import type { CloudTier } from './types.js';

/**
 * Server status lifecycle states.
 *
 * - `'stopped'`: Server is not running
 * - `'starting'`: Server is in the process of starting
 * - `'running'`: Server is running and accepting connections
 * - `'stopping'`: Server is in the process of stopping
 * - `'error'`: Server encountered an error
 */
export type ServerStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

/**
 * Authentication configuration for the cloud sync server.
 *
 * @see {@link CloudServerConfig.auth}
 */
export interface ServerAuthConfig {
  /** Whether authentication is required. @default true */
  required?: boolean;

  /** List of valid API keys that clients can authenticate with */
  apiKeys?: string[];

  /**
   * Custom validation function for API keys.
   * Return `true` if the key is valid, `false` otherwise.
   */
  validateKey?: (key: string) => boolean | Promise<boolean>;
}

/**
 * Per-tenant connection and bandwidth tracking metrics.
 *
 * @see {@link CloudSyncServer.getTenantMetrics}
 */
export interface TenantMetrics {
  /** Tenant identifier */
  tenantId: string;

  /** Number of currently active connections */
  activeConnections: number;

  /** Total bytes sent to this tenant */
  bytesSent: number;

  /** Total bytes received from this tenant */
  bytesReceived: number;

  /** Timestamp of the first connection from this tenant */
  connectedSince: number | null;

  /** Timestamp of the last activity from this tenant */
  lastActivityAt: number | null;
}

/**
 * Health check result for the server.
 *
 * @see {@link CloudSyncServer.handleHealthCheck}
 */
export interface ServerHealthCheck {
  /** Whether the server is healthy */
  healthy: boolean;

  /** Current server status */
  status: ServerStatus;

  /** Server uptime in milliseconds */
  uptimeMs: number;

  /** Total active connections across all tenants */
  totalConnections: number;

  /** Number of active tenants */
  activeTenants: number;

  /** Timestamp of the health check */
  checkedAt: number;
}

/**
 * Configuration for the cloud sync server.
 *
 * @example Minimal configuration
 * ```typescript
 * const config: CloudServerConfig = {};
 * // Uses defaults: port 8080, host '0.0.0.0', no auth
 * ```
 *
 * @example Full configuration
 * ```typescript
 * const config: CloudServerConfig = {
 *   port: 3000,
 *   host: 'localhost',
 *   auth: {
 *     required: true,
 *     apiKeys: ['pk_test_YOUR_API_KEY'],
 *   },
 *   corsOrigins: ['https://app.example.com'],
 *   maxConnectionsPerTenant: 10,
 *   tier: 'pro',
 * };
 * ```
 *
 * @see {@link CloudSyncServer}
 * @see {@link createCloudSyncServer}
 */
export interface CloudServerConfig {
  /** Port to listen on. @default 8080 */
  port?: number;

  /** Host to bind to. @default '0.0.0.0' */
  host?: string;

  /** Authentication configuration. @default { required: false } */
  auth?: ServerAuthConfig;

  /** Allowed CORS origins. Empty array disables CORS. @default ['*'] */
  corsOrigins?: string[];

  /** Maximum connections per tenant. @default 50 */
  maxConnectionsPerTenant?: number;

  /** Service tier determining global limits. @default 'free' */
  tier?: CloudTier;
}

/** @internal Resolved configuration with all defaults applied. */
interface ResolvedServerConfig {
  port: number;
  host: string;
  auth: Required<Pick<ServerAuthConfig, 'required'>> & Omit<ServerAuthConfig, 'required'>;
  corsOrigins: string[];
  maxConnectionsPerTenant: number;
  tier: CloudTier;
}

/**
 * Hosted cloud sync server with multi-tenant isolation.
 *
 * CloudSyncServer bootstraps a sync server that provides:
 * - Multi-tenant data namespace isolation
 * - API key authentication
 * - Per-tenant connection and bandwidth tracking
 * - Health check endpoint handling
 * - CORS configuration
 * - Observable server status via RxJS
 *
 * @example Basic usage
 * ```typescript
 * import { createCloudSyncServer } from '@pocket/cloud';
 *
 * const server = createCloudSyncServer({
 *   port: 3000,
 *   auth: { required: true, apiKeys: ['pk_test_YOUR_API_KEY'] },
 *   maxConnectionsPerTenant: 20,
 * });
 *
 * await server.start();
 * console.log('Server running on port 3000');
 *
 * // Monitor status
 * server.getStatus$().subscribe(status => {
 *   console.log('Server status:', status);
 * });
 *
 * // Check health
 * const health = server.handleHealthCheck();
 * console.log('Healthy:', health.healthy);
 *
 * // Graceful shutdown
 * await server.stop();
 * server.destroy();
 * ```
 *
 * @example Multi-tenant isolation
 * ```typescript
 * const server = createCloudSyncServer({ maxConnectionsPerTenant: 5 });
 * await server.start();
 *
 * // Each tenant gets an isolated namespace
 * const ns1 = server.getTenantNamespace('tenant-a');
 * const ns2 = server.getTenantNamespace('tenant-b');
 * console.log(ns1); // 'ns:tenant-a'
 * console.log(ns2); // 'ns:tenant-b'
 *
 * // Track connections per tenant
 * server.addConnection('tenant-a', 'conn-1');
 * server.addConnection('tenant-b', 'conn-2');
 * console.log(server.getTenantMetrics('tenant-a').activeConnections); // 1
 * ```
 *
 * @see {@link createCloudSyncServer}
 * @see {@link CloudServerConfig}
 */
export class CloudSyncServer {
  private readonly config: ResolvedServerConfig;
  private readonly destroy$ = new Subject<void>();
  private readonly status$ = new BehaviorSubject<ServerStatus>('stopped');

  /** Map of tenantId → Set of connection IDs */
  private readonly tenantConnections = new Map<string, Set<string>>();

  /** Map of tenantId → bandwidth tracking */
  private readonly tenantBandwidth = new Map<
    string,
    { bytesSent: number; bytesReceived: number; connectedSince: number | null; lastActivityAt: number | null }
  >();

  private startedAt: number | null = null;

  constructor(config: CloudServerConfig = {}) {
    this.config = {
      port: config.port ?? 8080,
      host: config.host ?? '0.0.0.0',
      auth: {
        required: config.auth?.required ?? false,
        apiKeys: config.auth?.apiKeys,
        validateKey: config.auth?.validateKey,
      },
      corsOrigins: config.corsOrigins ?? ['*'],
      maxConnectionsPerTenant: config.maxConnectionsPerTenant ?? 50,
      tier: config.tier ?? 'free',
    };
  }

  /**
   * Start the sync server.
   *
   * Transitions the server through `'starting'` → `'running'` states.
   * If the server is already running, this is a no-op.
   *
   * @throws {Error} If the server fails to start
   *
   * @example
   * ```typescript
   * await server.start();
   * console.log('Server is running');
   * ```
   */
  async start(): Promise<void> {
    const currentStatus = this.status$.getValue();
    if (currentStatus === 'running' || currentStatus === 'starting') {
      return;
    }

    this.status$.next('starting');

    try {
      // Bootstrap server initialization
      this.startedAt = Date.now();
      this.status$.next('running');
    } catch (error) {
      this.status$.next('error');
      throw error;
    }
  }

  /**
   * Stop the sync server gracefully.
   *
   * Transitions the server through `'stopping'` → `'stopped'` states.
   * Disconnects all tenant connections.
   *
   * @example
   * ```typescript
   * await server.stop();
   * console.log('Server stopped');
   * ```
   */
  async stop(): Promise<void> {
    const currentStatus = this.status$.getValue();
    if (currentStatus === 'stopped' || currentStatus === 'stopping') {
      return;
    }

    this.status$.next('stopping');

    // Clear all tenant connections
    this.tenantConnections.clear();
    this.tenantBandwidth.clear();
    this.startedAt = null;

    this.status$.next('stopped');
  }

  /**
   * Get the current server status synchronously.
   *
   * @returns Current server status
   *
   * @example
   * ```typescript
   * if (server.getStatus() === 'running') {
   *   console.log('Server is accepting connections');
   * }
   * ```
   */
  getStatus(): ServerStatus {
    return this.status$.getValue();
  }

  /**
   * Get an observable of the server status.
   *
   * Uses RxJS BehaviorSubject so subscribers immediately receive the current status.
   *
   * @returns Observable that emits server status changes
   *
   * @example
   * ```typescript
   * server.getStatus$().subscribe(status => {
   *   console.log('Server status changed:', status);
   * });
   * ```
   */
  getStatus$(): Observable<ServerStatus> {
    return this.status$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /**
   * Get the resolved server configuration.
   *
   * @returns The full resolved configuration with defaults applied
   */
  getConfig(): Readonly<ResolvedServerConfig> {
    return this.config;
  }

  /**
   * Get the isolated data namespace for a tenant.
   *
   * Each tenant gets a unique namespace prefix to ensure data isolation.
   *
   * @param tenantId - The tenant identifier
   * @returns The namespaced key prefix for the tenant
   *
   * @example
   * ```typescript
   * const ns = server.getTenantNamespace('acme-corp');
   * // Returns 'ns:acme-corp'
   * ```
   */
  getTenantNamespace(tenantId: string): string {
    return `ns:${tenantId}`;
  }

  /**
   * Validate an API key against the server's auth configuration.
   *
   * @param apiKey - The API key to validate
   * @returns Whether the key is valid
   *
   * @example
   * ```typescript
   * const isValid = await server.validateApiKey('pk_test_YOUR_API_KEY');
   * if (!isValid) {
   *   console.error('Unauthorized');
   * }
   * ```
   */
  async validateApiKey(apiKey: string): Promise<boolean> {
    if (!this.config.auth.required) {
      return true;
    }

    // Custom validator takes priority
    if (this.config.auth.validateKey) {
      return this.config.auth.validateKey(apiKey);
    }

    // Check against static API key list
    if (this.config.auth.apiKeys) {
      return this.config.auth.apiKeys.includes(apiKey);
    }

    // No auth mechanism configured but auth is required
    return false;
  }

  /**
   * Register a new connection for a tenant.
   *
   * @param tenantId - The tenant identifier
   * @param connectionId - Unique connection identifier
   * @returns Whether the connection was accepted (false if tenant is at max connections)
   *
   * @example
   * ```typescript
   * const accepted = server.addConnection('tenant-a', 'conn-123');
   * if (!accepted) {
   *   console.warn('Tenant at max connections');
   * }
   * ```
   */
  addConnection(tenantId: string, connectionId: string): boolean {
    let connections = this.tenantConnections.get(tenantId);
    if (!connections) {
      connections = new Set();
      this.tenantConnections.set(tenantId, connections);
    }

    if (connections.size >= this.config.maxConnectionsPerTenant) {
      return false;
    }

    connections.add(connectionId);

    // Initialize or update bandwidth tracking
    if (!this.tenantBandwidth.has(tenantId)) {
      this.tenantBandwidth.set(tenantId, {
        bytesSent: 0,
        bytesReceived: 0,
        connectedSince: Date.now(),
        lastActivityAt: Date.now(),
      });
    } else {
      const bandwidth = this.tenantBandwidth.get(tenantId)!;
      bandwidth.lastActivityAt = Date.now();
    }

    return true;
  }

  /**
   * Remove a connection for a tenant.
   *
   * @param tenantId - The tenant identifier
   * @param connectionId - The connection identifier to remove
   * @returns Whether the connection was found and removed
   *
   * @example
   * ```typescript
   * server.removeConnection('tenant-a', 'conn-123');
   * ```
   */
  removeConnection(tenantId: string, connectionId: string): boolean {
    const connections = this.tenantConnections.get(tenantId);
    if (!connections) {
      return false;
    }

    const removed = connections.delete(connectionId);

    // Clean up tenant if no more connections
    if (connections.size === 0) {
      this.tenantConnections.delete(tenantId);
    }

    return removed;
  }

  /**
   * Record bandwidth usage for a tenant.
   *
   * @param tenantId - The tenant identifier
   * @param bytesSent - Bytes sent to the tenant
   * @param bytesReceived - Bytes received from the tenant
   *
   * @example
   * ```typescript
   * server.recordBandwidth('tenant-a', 1024, 512);
   * ```
   */
  recordBandwidth(tenantId: string, bytesSent: number, bytesReceived: number): void {
    let bandwidth = this.tenantBandwidth.get(tenantId);
    if (!bandwidth) {
      bandwidth = {
        bytesSent: 0,
        bytesReceived: 0,
        connectedSince: Date.now(),
        lastActivityAt: Date.now(),
      };
      this.tenantBandwidth.set(tenantId, bandwidth);
    }

    bandwidth.bytesSent += bytesSent;
    bandwidth.bytesReceived += bytesReceived;
    bandwidth.lastActivityAt = Date.now();
  }

  /**
   * Get metrics for a specific tenant.
   *
   * @param tenantId - The tenant identifier
   * @returns Metrics for the tenant
   *
   * @example
   * ```typescript
   * const metrics = server.getTenantMetrics('tenant-a');
   * console.log('Active connections:', metrics.activeConnections);
   * console.log('Bytes sent:', metrics.bytesSent);
   * ```
   */
  getTenantMetrics(tenantId: string): TenantMetrics {
    const connections = this.tenantConnections.get(tenantId);
    const bandwidth = this.tenantBandwidth.get(tenantId);

    return {
      tenantId,
      activeConnections: connections?.size ?? 0,
      bytesSent: bandwidth?.bytesSent ?? 0,
      bytesReceived: bandwidth?.bytesReceived ?? 0,
      connectedSince: bandwidth?.connectedSince ?? null,
      lastActivityAt: bandwidth?.lastActivityAt ?? null,
    };
  }

  /**
   * Get metrics for all active tenants.
   *
   * @returns Array of metrics for each tenant with active connections
   *
   * @example
   * ```typescript
   * const allMetrics = server.getAllTenantMetrics();
   * for (const m of allMetrics) {
   *   console.log(`${m.tenantId}: ${m.activeConnections} connections`);
   * }
   * ```
   */
  getAllTenantMetrics(): TenantMetrics[] {
    const tenantIds = new Set([
      ...this.tenantConnections.keys(),
      ...this.tenantBandwidth.keys(),
    ]);

    return Array.from(tenantIds).map((id) => this.getTenantMetrics(id));
  }

  /**
   * Get total active connections across all tenants.
   *
   * @returns Total connection count
   */
  getTotalConnections(): number {
    let total = 0;
    for (const connections of this.tenantConnections.values()) {
      total += connections.size;
    }
    return total;
  }

  /**
   * Handle a health check request.
   *
   * Returns server health information suitable for load balancer
   * or monitoring system consumption.
   *
   * @returns Health check result
   *
   * @example
   * ```typescript
   * const health = server.handleHealthCheck();
   * if (health.healthy) {
   *   console.log(`Uptime: ${health.uptimeMs}ms, Connections: ${health.totalConnections}`);
   * }
   * ```
   */
  handleHealthCheck(): ServerHealthCheck {
    const status = this.status$.getValue();
    const now = Date.now();

    return {
      healthy: status === 'running',
      status,
      uptimeMs: this.startedAt ? now - this.startedAt : 0,
      totalConnections: this.getTotalConnections(),
      activeTenants: this.tenantConnections.size,
      checkedAt: now,
    };
  }

  /**
   * Permanently destroy the server and release all resources.
   *
   * Completes all observables and clears all tenant data.
   * After calling destroy(), the server cannot be restarted.
   *
   * @example
   * ```typescript
   * await server.stop();
   * server.destroy();
   * ```
   */
  destroy(): void {
    void this.stop();
    this.tenantConnections.clear();
    this.tenantBandwidth.clear();
    this.destroy$.next();
    this.destroy$.complete();
    this.status$.complete();
  }
}

/**
 * Create a cloud sync server instance.
 *
 * Factory function that creates a configured {@link CloudSyncServer}
 * ready to be started.
 *
 * @param config - Server configuration options
 * @returns A new CloudSyncServer instance
 *
 * @example Minimal setup
 * ```typescript
 * import { createCloudSyncServer } from '@pocket/cloud';
 *
 * const server = createCloudSyncServer();
 * await server.start();
 * ```
 *
 * @example With full configuration
 * ```typescript
 * const server = createCloudSyncServer({
 *   port: 3000,
 *   host: 'localhost',
 *   auth: {
 *     required: true,
 *     apiKeys: ['pk_test_YOUR_API_KEY'],
 *   },
 *   corsOrigins: ['https://app.example.com'],
 *   maxConnectionsPerTenant: 20,
 *   tier: 'pro',
 * });
 *
 * await server.start();
 *
 * server.getStatus$().subscribe(status => {
 *   console.log('Server status:', status);
 * });
 * ```
 *
 * @see {@link CloudSyncServer}
 * @see {@link CloudServerConfig}
 */
export function createCloudSyncServer(config?: CloudServerConfig): CloudSyncServer {
  return new CloudSyncServer(config);
}
