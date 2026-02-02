/**
 * EdgeSyncServer - Edge-compatible sync server for Pocket.
 *
 * Designed for serverless edge runtimes (Cloudflare Workers, Deno Deploy,
 * Vercel Edge) with no long-lived connections or persistent state.
 */

export interface EdgeSyncConfig {
  /** Storage adapter for persisting sync state */
  storage: EdgeSyncStorage;
  /** Authentication handler */
  authenticate?: (request: EdgeRequest) => Promise<AuthResult>;
  /** Conflict resolution strategy. @default 'last-write-wins' */
  conflictStrategy?: 'last-write-wins' | 'server-wins' | 'client-wins';
  /** Maximum changes per request. @default 100 */
  maxChangesPerRequest?: number;
  /** CORS allowed origins. @default [] */
  corsOrigins?: string[];
  /** Enable request logging. @default false */
  enableLogging?: boolean;
}

export interface EdgeSyncStorage {
  getChanges(collection: string, sinceCheckpoint: string | null, limit: number): Promise<SyncChange[]>;
  putChanges(changes: SyncChange[]): Promise<void>;
  getCheckpoint(clientId: string): Promise<string | null>;
  setCheckpoint(clientId: string, checkpoint: string): Promise<void>;
  getDocument(collection: string, id: string): Promise<Record<string, unknown> | null>;
}

export interface SyncChange {
  id: string;
  collection: string;
  documentId: string;
  operation: 'insert' | 'update' | 'delete';
  data: Record<string, unknown> | null;
  timestamp: number;
  clientId: string;
  checkpoint: string;
}

export interface EdgeRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}

export interface EdgeResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface AuthResult {
  authenticated: boolean;
  clientId?: string;
  permissions?: string[];
  error?: string;
}

export interface EdgeSyncStats {
  totalRequests: number;
  pushRequests: number;
  pullRequests: number;
  totalChangesProcessed: number;
  totalConflicts: number;
  avgResponseTimeMs: number;
  errors: number;
}

export class EdgeSyncServer {
  private readonly config: EdgeSyncConfig;
  private readonly stats: EdgeSyncStats = {
    totalRequests: 0,
    pushRequests: 0,
    pullRequests: 0,
    totalChangesProcessed: 0,
    totalConflicts: 0,
    avgResponseTimeMs: 0,
    errors: 0,
  };
  private totalResponseTime = 0;

  constructor(config: EdgeSyncConfig) {
    this.config = config;
  }

  /**
   * Handle an incoming HTTP request.
   * This is the main entry point for edge function handlers.
   */
  async handleRequest(request: EdgeRequest): Promise<EdgeResponse> {
    const start = Date.now();
    this.stats.totalRequests++;

    try {
      // CORS preflight
      if (request.method === 'OPTIONS') {
        return this.corsResponse();
      }

      // Authentication
      if (this.config.authenticate) {
        const auth = await this.config.authenticate(request);
        if (!auth.authenticated) {
          return this.jsonResponse(401, { error: auth.error ?? 'Unauthorized' });
        }
      }

      // Route
      const url = new URL(request.url, 'https://localhost');
      const path = url.pathname;

      if (request.method === 'POST' && path.endsWith('/push')) {
        return await this.handlePush(request);
      }

      if (request.method === 'POST' && path.endsWith('/pull')) {
        return await this.handlePull(request);
      }

      if (request.method === 'GET' && path.endsWith('/health')) {
        return this.handleHealth();
      }

      if (request.method === 'GET' && path.endsWith('/stats')) {
        return this.jsonResponse(200, this.stats);
      }

      return this.jsonResponse(404, { error: 'Not found' });
    } catch (error) {
      this.stats.errors++;
      const message = error instanceof Error ? error.message : String(error);
      if (this.config.enableLogging) {
        console.error('[EdgeSyncServer] Error:', message);
      }
      return this.jsonResponse(500, { error: 'Internal server error', message });
    } finally {
      const duration = Date.now() - start;
      this.totalResponseTime += duration;
      this.stats.avgResponseTimeMs = this.totalResponseTime / this.stats.totalRequests;
    }
  }

  /**
   * Create a fetch handler compatible with edge runtimes.
   */
  asFetchHandler(): (request: Request) => Promise<Response> {
    return async (request: Request): Promise<Response> => {
      const edgeRequest: EdgeRequest = {
        method: request.method,
        url: request.url,
        headers: Object.fromEntries(request.headers.entries()),
        body: request.method !== 'GET' && request.method !== 'HEAD'
          ? await request.json().catch(() => undefined)
          : undefined,
      };

      const edgeResponse = await this.handleRequest(edgeRequest);

      return new Response(JSON.stringify(edgeResponse.body), {
        status: edgeResponse.status,
        headers: edgeResponse.headers,
      });
    };
  }

  /**
   * Get current server stats.
   */
  getStats(): EdgeSyncStats {
    return { ...this.stats };
  }

  private async handlePush(request: EdgeRequest): Promise<EdgeResponse> {
    this.stats.pushRequests++;

    const body = request.body as { changes: SyncChange[]; clientId: string } | undefined;
    if (!body?.changes || !Array.isArray(body.changes)) {
      return this.jsonResponse(400, { error: 'Missing changes array' });
    }

    if (body.changes.length > (this.config.maxChangesPerRequest ?? 100)) {
      return this.jsonResponse(400, {
        error: `Too many changes. Maximum is ${this.config.maxChangesPerRequest ?? 100}`,
      });
    }

    // Apply changes
    const conflicts: SyncChange[] = [];
    const applied: SyncChange[] = [];

    for (const change of body.changes) {
      // Check for conflicts
      const existing = await this.config.storage.getDocument(change.collection, change.documentId);
      if (existing && change.operation === 'update') {
        const existingTimestamp = (existing._timestamp as number) ?? 0;
        if (existingTimestamp > change.timestamp) {
          // Conflict detected
          this.stats.totalConflicts++;
          const resolved = this.resolveConflict(change, existing);
          if (resolved) {
            applied.push(resolved);
          } else {
            conflicts.push(change);
          }
          continue;
        }
      }

      applied.push(change);
    }

    if (applied.length > 0) {
      await this.config.storage.putChanges(applied);
    }

    this.stats.totalChangesProcessed += applied.length;

    // Update client checkpoint
    const lastChange = applied[applied.length - 1];
    if (lastChange && body.clientId) {
      await this.config.storage.setCheckpoint(body.clientId, lastChange.checkpoint);
    }

    return this.jsonResponse(200, {
      applied: applied.length,
      conflicts: conflicts.length,
      checkpoint: lastChange?.checkpoint ?? null,
    });
  }

  private async handlePull(request: EdgeRequest): Promise<EdgeResponse> {
    this.stats.pullRequests++;

    const body = request.body as { clientId: string; collections?: string[]; limit?: number } | undefined;
    if (!body?.clientId) {
      return this.jsonResponse(400, { error: 'Missing clientId' });
    }

    const checkpoint = await this.config.storage.getCheckpoint(body.clientId);
    const limit = Math.min(body.limit ?? 100, this.config.maxChangesPerRequest ?? 100);

    const allChanges: SyncChange[] = [];
    const collections = body.collections ?? ['*'];

    for (const collection of collections) {
      const changes = await this.config.storage.getChanges(collection, checkpoint, limit);
      allChanges.push(...changes);
    }

    // Sort by timestamp and limit
    allChanges.sort((a, b) => a.timestamp - b.timestamp);
    const limited = allChanges.slice(0, limit);

    // Update client checkpoint
    const lastChange = limited[limited.length - 1];
    if (lastChange) {
      await this.config.storage.setCheckpoint(body.clientId, lastChange.checkpoint);
    }

    return this.jsonResponse(200, {
      changes: limited,
      checkpoint: lastChange?.checkpoint ?? checkpoint,
      hasMore: allChanges.length > limit,
    });
  }

  private handleHealth(): EdgeResponse {
    return this.jsonResponse(200, {
      status: 'healthy',
      timestamp: Date.now(),
      stats: {
        totalRequests: this.stats.totalRequests,
        avgResponseTimeMs: Math.round(this.stats.avgResponseTimeMs),
      },
    });
  }

  private resolveConflict(
    clientChange: SyncChange,
    serverDoc: Record<string, unknown>
  ): SyncChange | null {
    const strategy = this.config.conflictStrategy ?? 'last-write-wins';

    switch (strategy) {
      case 'last-write-wins':
        return clientChange.timestamp >= ((serverDoc._timestamp as number) ?? 0) ? clientChange : null;
      case 'server-wins':
        return null;
      case 'client-wins':
        return clientChange;
    }
  }

  private corsResponse(): EdgeResponse {
    return {
      status: 204,
      headers: this.corsHeaders(),
      body: null,
    };
  }

  private jsonResponse(status: number, body: unknown): EdgeResponse {
    return {
      status,
      headers: {
        'Content-Type': 'application/json',
        ...this.corsHeaders(),
      },
      body,
    };
  }

  private corsHeaders(): Record<string, string> {
    const origins = this.config.corsOrigins ?? [];
    return {
      'Access-Control-Allow-Origin': origins.length > 0 ? origins.join(', ') : '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Pocket-Client-Id',
      'Access-Control-Max-Age': '86400',
    };
  }
}

export function createEdgeSyncServer(config: EdgeSyncConfig): EdgeSyncServer {
  return new EdgeSyncServer(config);
}
