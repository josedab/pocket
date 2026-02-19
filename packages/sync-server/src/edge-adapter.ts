/**
 * Edge Deployment Adapters for Pocket Sync Server
 *
 * Enables deployment to Cloudflare Workers, Deno Deploy, Vercel Edge, and AWS Lambda.
 * Provides HTTP request/response handling since edge runtimes don't have native
 * WebSocket servers like Node.js.
 *
 * @module @pocket/sync-server
 */

import type { StorageBackend } from './types.js';

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Supported edge runtime environments
 */
export type EdgeRuntime =
  | 'cloudflare-workers'
  | 'deno-deploy'
  | 'vercel-edge'
  | 'aws-lambda'
  | 'generic';

/**
 * Incoming request from an edge runtime
 */
export interface EdgeRequest {
  /** Full request URL */
  url: string;
  /** HTTP method */
  method: string;
  /** Request headers */
  headers: Record<string, string>;
  /** Request body */
  body?: string | ArrayBuffer | null;
  /** Cloudflare-specific request properties */
  cf?: Record<string, unknown>;
}

/**
 * Response to send from an edge runtime
 */
export interface EdgeResponse {
  /** HTTP status code */
  status: number;
  /** Response headers */
  headers: Record<string, string>;
  /** Response body */
  body: string | ArrayBuffer | null;
}

/**
 * Configuration for the edge sync adapter
 */
export interface EdgeAdapterConfig {
  /** Target edge runtime */
  runtime: EdgeRuntime;
  /** Application identifier */
  appId: string;
  /** Deployment region hint */
  region?: string;
  /** Storage backend for persisting sync data */
  storage?: StorageBackend;
  /** Authentication configuration */
  auth?: {
    type: 'jwt' | 'api-key' | 'custom';
    secret?: string;
    validate?: (token: string) => Promise<boolean | { userId: string }>;
  };
  /** CORS configuration */
  cors?: {
    origins: string[];
    maxAge?: number;
  };
  /** Maximum concurrent connections */
  maxConnections?: number;
  /** Enable request logging */
  logging?: boolean;
}

/**
 * Metrics collected by the edge adapter
 */
export interface EdgeAdapterMetrics {
  /** Number of active connections */
  activeConnections: number;
  /** Total requests handled */
  totalRequests: number;
  /** Requests per second (approximate) */
  requestsPerSecond: number;
  /** Adapter uptime in milliseconds */
  uptime: number;
}

/**
 * Default edge adapter configuration values
 */
const DEFAULT_EDGE_CONFIG: Required<Omit<EdgeAdapterConfig, 'storage' | 'auth' | 'region'>> = {
  runtime: 'generic',
  appId: 'pocket-sync',
  cors: { origins: [], maxAge: 86400 },
  maxConnections: 1000,
  logging: false,
};

/**
 * Edge sync adapter for serverless and edge runtimes
 *
 * Handles HTTP-based sync operations (push, pull, health) for environments
 * that do not support persistent WebSocket connections natively.
 *
 * @example
 * ```typescript
 * import { createEdgeAdapter } from '@pocket/sync-server';
 *
 * const adapter = createEdgeAdapter({
 *   runtime: 'cloudflare-workers',
 *   appId: 'my-app',
 * });
 *
 * export default {
 *   async fetch(request: Request) {
 *     const edgeReq = {
 *       url: request.url,
 *       method: request.method,
 *       headers: Object.fromEntries(request.headers),
 *       body: await request.text(),
 *     };
 *     const res = await adapter.handleRequest(edgeReq);
 *     return new Response(res.body, { status: res.status, headers: res.headers });
 *   },
 * };
 * ```
 */
export class EdgeSyncAdapter {
  private readonly config: Required<Omit<EdgeAdapterConfig, 'storage' | 'auth' | 'region'>> &
    Pick<EdgeAdapterConfig, 'storage' | 'auth' | 'region'>;
  private activeConnections = 0;
  private totalRequests = 0;
  private readonly startTime = Date.now();
  private recentRequests: number[] = [];

  constructor(config: EdgeAdapterConfig) {
    this.config = {
      ...DEFAULT_EDGE_CONFIG,
      ...config,
    };
  }

  /**
   * Handle an incoming edge request
   *
   * Routes the request to the appropriate handler based on URL path:
   * - `/sync/push` — handle push operations
   * - `/sync/pull` — handle pull operations
   * - `/sync/health` — health check endpoint
   * - `/sync/ws` — WebSocket upgrade (runtime-dependent)
   */
  async handleRequest(req: EdgeRequest): Promise<EdgeResponse> {
    this.totalRequests++;
    this.recentRequests.push(Date.now());

    // Apply CORS headers
    const corsHeaders = this.buildCorsHeaders(req);

    // Handle preflight
    if (req.method === 'OPTIONS') {
      return { status: 204, headers: corsHeaders, body: null };
    }

    // Authenticate if configured
    if (this.config.auth) {
      const authResult = await this.authenticate(req);
      if (!authResult.authenticated) {
        return {
          status: 401,
          headers: { ...corsHeaders, 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'Unauthorized', id: generateId() }),
        };
      }
    }

    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;

    try {
      if (path.endsWith('/push') && req.method === 'POST') {
        return await this.handlePush(req, corsHeaders);
      }

      if (path.endsWith('/pull') && (req.method === 'GET' || req.method === 'POST')) {
        return await this.handlePull(req, corsHeaders);
      }

      if (path.endsWith('/health')) {
        return this.handleHealth(corsHeaders);
      }

      if (path.endsWith('/ws')) {
        return this.handleWebSocketUpgrade(req, corsHeaders);
      }

      return {
        status: 404,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'Not found', id: generateId() }),
      };
    } catch (error) {
      this.log('error', 'Request handler error:', error);
      return {
        status: 500,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'Internal server error', id: generateId() }),
      };
    }
  }

  /**
   * Handle a WebSocket upgrade request
   *
   * Only supported on runtimes that provide WebSocket upgrade capability
   * (e.g., Cloudflare Workers with Durable Objects, Deno Deploy).
   */
  handleWebSocketUpgrade(req: EdgeRequest, corsHeaders: Record<string, string> = {}): EdgeResponse {
    const upgradeHeader = req.headers.upgrade ?? req.headers.Upgrade;

    if (upgradeHeader?.toLowerCase() !== 'websocket') {
      return {
        status: 426,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({
          error: 'WebSocket upgrade required',
          id: generateId(),
        }),
      };
    }

    // Runtime-specific upgrade handling
    if (this.config.runtime === 'cloudflare-workers' || this.config.runtime === 'deno-deploy') {
      this.activeConnections++;
      return {
        status: 101,
        headers: {
          ...corsHeaders,
          upgrade: 'websocket',
          connection: 'Upgrade',
          'x-pocket-client-id': generateId(),
        },
        body: null,
      };
    }

    return {
      status: 501,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({
        error: `WebSocket upgrade not supported on ${this.config.runtime}`,
        id: generateId(),
      }),
    };
  }

  /**
   * Handle a push request (POST /sync/push)
   *
   * Accepts sync changes and persists them via the storage backend.
   */
  private async handlePush(
    req: EdgeRequest,
    corsHeaders: Record<string, string>
  ): Promise<EdgeResponse> {
    if (!this.config.storage) {
      return {
        status: 503,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'Storage not configured', id: generateId() }),
      };
    }

    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : null;
    if (!payload?.collection || !Array.isArray(payload.changes)) {
      return {
        status: 400,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid push payload', id: generateId() }),
      };
    }

    for (const change of payload.changes as Record<string, unknown>[]) {
      await this.config.storage.recordChange({
        ...change,
        timestamp: Date.now(),
        clientId: (change.clientId as string) ?? 'edge-client',
      } as Parameters<StorageBackend['recordChange']>[0]);
    }

    return {
      status: 200,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({
        success: true,
        id: generateId(),
        serverTimestamp: Date.now(),
      }),
    };
  }

  /**
   * Handle a pull request (GET/POST /sync/pull)
   *
   * Returns sync changes from the storage backend since a given timestamp.
   */
  private async handlePull(
    req: EdgeRequest,
    corsHeaders: Record<string, string>
  ): Promise<EdgeResponse> {
    if (!this.config.storage) {
      return {
        status: 503,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'Storage not configured', id: generateId() }),
      };
    }

    let collection: string | undefined;
    let since = 0;
    let limit: number | undefined;

    if (req.method === 'POST' && typeof req.body === 'string') {
      const payload = JSON.parse(req.body) as Record<string, unknown>;
      collection = payload.collection as string | undefined;
      since = (payload.since as number) ?? 0;
      limit = payload.limit as number | undefined;
    } else {
      const url = new URL(req.url, 'http://localhost');
      collection = url.searchParams.get('collection') ?? undefined;
      since = Number(url.searchParams.get('since') ?? 0);
      const limitParam = url.searchParams.get('limit');
      limit = limitParam ? Number(limitParam) : undefined;
    }

    if (!collection) {
      return {
        status: 400,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'Collection is required', id: generateId() }),
      };
    }

    const changes = await this.config.storage.getChanges(collection, since, limit);

    return {
      status: 200,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({
        id: generateId(),
        collection,
        changes,
        serverTimestamp: Date.now(),
        hasMore: limit ? changes.length >= limit : false,
      }),
    };
  }

  /**
   * Handle a health check request (GET /sync/health)
   *
   * Returns current adapter status and basic metrics.
   */
  private handleHealth(corsHeaders: Record<string, string>): EdgeResponse {
    const metrics = this.getMetrics();

    return {
      status: 200,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({
        status: 'ok',
        id: generateId(),
        runtime: this.config.runtime,
        appId: this.config.appId,
        region: this.config.region,
        metrics,
        timestamp: Date.now(),
      }),
    };
  }

  /**
   * Get current adapter metrics
   *
   * Returns connection counts, request throughput, and uptime.
   */
  getMetrics(): EdgeAdapterMetrics {
    const now = Date.now();

    // Keep only requests from the last second for rate calculation
    this.recentRequests = this.recentRequests.filter((t) => now - t < 1000);

    return {
      activeConnections: this.activeConnections,
      totalRequests: this.totalRequests,
      requestsPerSecond: this.recentRequests.length,
      uptime: now - this.startTime,
    };
  }

  /**
   * Authenticate an incoming request
   */
  private async authenticate(
    req: EdgeRequest
  ): Promise<{ authenticated: boolean; userId?: string }> {
    if (!this.config.auth) {
      return { authenticated: true };
    }

    const authHeader = req.headers.authorization ?? req.headers.Authorization ?? '';

    if (this.config.auth.type === 'api-key') {
      const apiKey = authHeader.replace(/^Bearer\s+/i, '');
      if (apiKey === this.config.auth.secret) {
        return { authenticated: true };
      }
      return { authenticated: false };
    }

    if (this.config.auth.validate) {
      const token = authHeader.replace(/^Bearer\s+/i, '');
      const result = await this.config.auth.validate(token);
      if (typeof result === 'object') {
        return { authenticated: true, userId: result.userId };
      }
      return { authenticated: result };
    }

    return { authenticated: false };
  }

  /**
   * Build CORS headers for a request
   */
  private buildCorsHeaders(req: EdgeRequest): Record<string, string> {
    const cors = this.config.cors;
    const origin = req.headers.origin ?? req.headers.Origin ?? '';

    const headers: Record<string, string> = {};

    if (cors.origins.length > 0 && cors.origins.includes(origin)) {
      headers['access-control-allow-origin'] = origin;
      headers['access-control-allow-methods'] = 'GET, POST, OPTIONS';
      headers['access-control-allow-headers'] = 'Content-Type, Authorization';
      if (cors.maxAge !== undefined) {
        headers['access-control-max-age'] = String(cors.maxAge);
      }
    }

    return headers;
  }

  /**
   * Log a message when logging is enabled
   */
  private log(level: string, message: string, ...args: unknown[]): void {
    if (!this.config.logging) return;

    const prefix = `[pocket-edge] [${level.toUpperCase()}]`;
    if (level === 'error') {
      console.error(prefix, message, ...args);
    } else {
      console.log(prefix, message, ...args);
    }
  }
}

/**
 * Create an edge sync adapter
 *
 * @example
 * ```typescript
 * import { createEdgeAdapter } from '@pocket/sync-server';
 *
 * const adapter = createEdgeAdapter({
 *   runtime: 'cloudflare-workers',
 *   appId: 'my-app',
 * });
 * ```
 */
export function createEdgeAdapter(config: EdgeAdapterConfig): EdgeSyncAdapter {
  return new EdgeSyncAdapter(config);
}

/**
 * Create a one-line edge sync adapter with sensible defaults
 *
 * Convenience factory for quick setup — only requires an app ID.
 *
 * @example
 * ```typescript
 * import { createOneLineSync } from '@pocket/sync-server';
 *
 * const adapter = createOneLineSync('my-app');
 * ```
 */
export function createOneLineSync(
  appId: string,
  options?: Partial<EdgeAdapterConfig>
): EdgeSyncAdapter {
  return new EdgeSyncAdapter({
    runtime: 'generic',
    appId,
    ...options,
  });
}
