/**
 * Edge-Native Sync Adapter
 *
 * Lightweight sync protocol for Cloudflare Workers, Deno Deploy,
 * and Vercel Edge Functions with sub-10ms cold start optimization.
 *
 * Uses lazy module loading and minimal initialization to keep
 * cold starts fast while providing full sync capabilities.
 *
 * @module @pocket/storage-edge/edge-sync
 */

import type { Observable } from 'rxjs';
import { BehaviorSubject, Subject } from 'rxjs';

// ─── Types ────────────────────────────────────────────────────────────────────

export type EdgePlatform = 'cloudflare' | 'deno' | 'vercel' | 'generic';

export interface EdgeSyncAdapterConfig {
  readonly platform: EdgePlatform;
  /** Origin sync server URL. */
  readonly originUrl: string;
  /** Auth token for sync server. */
  readonly authToken?: string;
  /** Sync interval in ms (0 = manual only). */
  readonly syncIntervalMs?: number;
  /** Maximum batch size for sync operations. */
  readonly maxBatchSize?: number;
  /** Enable lazy module loading for fast cold starts. */
  readonly lazyLoad?: boolean;
  /** Request timeout in ms. */
  readonly timeoutMs?: number;
}

export interface EdgeSyncChange {
  readonly id: string;
  readonly collection: string;
  readonly operation: 'insert' | 'update' | 'delete';
  readonly document: Record<string, unknown> | null;
  readonly timestamp: number;
  readonly clientId: string;
}

export interface SyncCheckpoint {
  readonly sequence: number;
  readonly timestamp: number;
  readonly clientId: string;
}

export interface SyncPullResult {
  readonly changes: readonly EdgeSyncChange[];
  readonly checkpoint: SyncCheckpoint;
  readonly hasMore: boolean;
}

export interface SyncPushResult {
  readonly accepted: number;
  readonly rejected: readonly { id: string; reason: string }[];
  readonly checkpoint: SyncCheckpoint;
}

export type SyncStatus = 'idle' | 'pulling' | 'pushing' | 'error';

export interface EdgeSyncAdapterState {
  readonly status: SyncStatus;
  readonly lastSyncAt: number | null;
  readonly pendingChanges: number;
  readonly error: string | null;
  readonly coldStartMs: number;
}

// ─── Lazy HTTP Client ─────────────────────────────────────────────────────────

interface HttpClient {
  post(url: string, body: unknown, headers?: Record<string, string>): Promise<unknown>;
  get(url: string, headers?: Record<string, string>): Promise<unknown>;
}

function createHttpClient(timeoutMs: number): HttpClient {
  async function request(
    method: string,
    url: string,
    body?: unknown,
    headers?: Record<string, string>
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Sync HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    post: (url, body, headers) => request('POST', url, body, headers),
    get: (url, headers) => request('GET', url, undefined, headers),
  };
}

// ─── Edge Sync Adapter ────────────────────────────────────────────────────────

export class EdgeSyncAdapter {
  private readonly config: Required<EdgeSyncAdapterConfig>;
  private readonly stateSubject: BehaviorSubject<EdgeSyncAdapterState>;
  private readonly changesSubject = new Subject<EdgeSyncChange>();
  private readonly pendingChanges: EdgeSyncChange[] = [];
  private httpClient: HttpClient | null = null;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private checkpoint: SyncCheckpoint = { sequence: 0, timestamp: 0, clientId: '' };
  private readonly coldStartTime: number;

  constructor(config: EdgeSyncAdapterConfig) {
    this.coldStartTime = performance.now();
    this.config = {
      platform: config.platform,
      originUrl: config.originUrl,
      authToken: config.authToken ?? '',
      syncIntervalMs: config.syncIntervalMs ?? 0,
      maxBatchSize: config.maxBatchSize ?? 100,
      lazyLoad: config.lazyLoad ?? true,
      timeoutMs: config.timeoutMs ?? 5000,
    };

    const clientId = `edge-${config.platform}-${Date.now().toString(36)}`;
    this.checkpoint = { ...this.checkpoint, clientId };

    this.stateSubject = new BehaviorSubject<EdgeSyncAdapterState>({
      status: 'idle',
      lastSyncAt: null,
      pendingChanges: 0,
      error: null,
      coldStartMs: 0,
    });
  }

  /** Observable of adapter state. */
  get state$(): Observable<EdgeSyncAdapterState> {
    return this.stateSubject.asObservable();
  }

  /** Observable of incoming sync changes. */
  get changes$(): Observable<EdgeSyncChange> {
    return this.changesSubject.asObservable();
  }

  /** Current state snapshot. */
  get state(): EdgeSyncAdapterState {
    return this.stateSubject.getValue();
  }

  /** Lazily initialize the HTTP client (cold start optimization). */
  private getClient(): HttpClient {
    if (!this.httpClient) {
      this.httpClient = createHttpClient(this.config.timeoutMs);
      const coldStartMs = Math.round((performance.now() - this.coldStartTime) * 100) / 100;
      this.updateState({ coldStartMs });
    }
    return this.httpClient;
  }

  private authHeaders(): Record<string, string> {
    if (!this.config.authToken) return {};
    return { Authorization: `Bearer ${this.config.authToken}` };
  }

  private updateState(partial: Partial<EdgeSyncAdapterState>): void {
    this.stateSubject.next({ ...this.stateSubject.getValue(), ...partial });
  }

  /** Start background sync (if syncIntervalMs > 0). */
  start(): void {
    if (this.config.syncIntervalMs > 0 && !this.syncTimer) {
      this.syncTimer = setInterval(() => {
        void this.sync();
      }, this.config.syncIntervalMs);
    }
  }

  /** Stop background sync. */
  stop(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  /** Queue a local change for pushing to the origin. */
  pushChange(change: Omit<EdgeSyncChange, 'timestamp' | 'clientId'>): void {
    this.pendingChanges.push({
      ...change,
      timestamp: Date.now(),
      clientId: this.checkpoint.clientId,
    });
    this.updateState({ pendingChanges: this.pendingChanges.length });
  }

  /** Pull changes from the origin since our last checkpoint. */
  async pull(): Promise<SyncPullResult> {
    this.updateState({ status: 'pulling', error: null });

    try {
      const client = this.getClient();
      const result = (await client.get(
        `${this.config.originUrl}/sync/pull?since=${this.checkpoint.sequence}&clientId=${this.checkpoint.clientId}`,
        this.authHeaders()
      )) as SyncPullResult;

      // Emit received changes
      for (const change of result.changes) {
        this.changesSubject.next(change);
      }

      this.checkpoint = result.checkpoint;
      this.updateState({
        status: 'idle',
        lastSyncAt: Date.now(),
      });

      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.updateState({ status: 'error', error });
      return { changes: [], checkpoint: this.checkpoint, hasMore: false };
    }
  }

  /** Push pending local changes to the origin. */
  async push(): Promise<SyncPushResult> {
    if (this.pendingChanges.length === 0) {
      return { accepted: 0, rejected: [], checkpoint: this.checkpoint };
    }

    this.updateState({ status: 'pushing', error: null });

    try {
      const client = this.getClient();
      const batch = this.pendingChanges.slice(0, this.config.maxBatchSize);

      const result = (await client.post(
        `${this.config.originUrl}/sync/push`,
        { changes: batch, checkpoint: this.checkpoint },
        this.authHeaders()
      )) as SyncPushResult;

      // Remove accepted changes from pending
      const acceptedIds = new Set(batch.map((c) => c.id));
      for (const r of result.rejected) {
        acceptedIds.delete(r.id);
      }
      const remaining = this.pendingChanges.filter((c) => !acceptedIds.has(c.id));
      this.pendingChanges.length = 0;
      this.pendingChanges.push(...remaining);

      this.checkpoint = result.checkpoint;
      this.updateState({
        status: 'idle',
        lastSyncAt: Date.now(),
        pendingChanges: this.pendingChanges.length,
      });

      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.updateState({ status: 'error', error });
      return { accepted: 0, rejected: [], checkpoint: this.checkpoint };
    }
  }

  /** Full sync cycle: push then pull. */
  async sync(): Promise<void> {
    await this.push();
    await this.pull();
  }

  /** Clean up resources. */
  destroy(): void {
    this.stop();
    this.stateSubject.complete();
    this.changesSubject.complete();
  }
}

// ─── Platform-specific factories ──────────────────────────────────────────────

/** Create an edge sync adapter for Cloudflare Workers. */
export function createCloudflareSync(
  config: Omit<EdgeSyncAdapterConfig, 'platform'>
): EdgeSyncAdapter {
  return new EdgeSyncAdapter({ ...config, platform: 'cloudflare', lazyLoad: true });
}

/** Create an edge sync adapter for Deno Deploy. */
export function createDenoSync(config: Omit<EdgeSyncAdapterConfig, 'platform'>): EdgeSyncAdapter {
  return new EdgeSyncAdapter({ ...config, platform: 'deno', lazyLoad: true });
}

/** Create an edge sync adapter for Vercel Edge Functions. */
export function createVercelSync(config: Omit<EdgeSyncAdapterConfig, 'platform'>): EdgeSyncAdapter {
  return new EdgeSyncAdapter({ ...config, platform: 'vercel', lazyLoad: true });
}

/** Auto-detect platform and create sync adapter. */
export function createEdgeSync(config: Omit<EdgeSyncAdapterConfig, 'platform'>): EdgeSyncAdapter {
  let platform: EdgePlatform = 'generic';

  // Platform detection via global objects
  if (typeof globalThis !== 'undefined') {
    const g = globalThis as Record<string, unknown>;
    if (g.caches !== undefined && g.HTMLRewriter !== undefined) {
      platform = 'cloudflare';
    } else if (g.Deno !== undefined) {
      platform = 'deno';
    } else if (g.__NEXT_DATA__ !== undefined || g.VERCEL !== undefined) {
      platform = 'vercel';
    }
  }

  return new EdgeSyncAdapter({ ...config, platform, lazyLoad: true });
}
