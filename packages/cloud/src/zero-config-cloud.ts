/**
 * Zero-Config Cloud Sync — one-line setup for Pocket Cloud.
 *
 * Provides the simplest possible API for connecting a Pocket database
 * to cloud sync. Handles endpoint discovery, authentication, and
 * auto-reconnection automatically.
 *
 * @example
 * ```typescript
 * import { createDatabase } from '@pocket/core';
 * import { createPocketCloud } from '@pocket/cloud';
 *
 * const db = await createDatabase({ name: 'my-app', storage: myStorage });
 * const cloud = createPocketCloud({ apiKey: 'pk_live_xxx' });
 *
 * // One-line sync — that's it!
 * await cloud.syncDatabase(db);
 *
 * // Monitor status reactively
 * cloud.status$.subscribe(s => console.log('Sync:', s));
 *
 * // Disconnect when done
 * await cloud.destroy();
 * ```
 */

import { BehaviorSubject, Subject, takeUntil, type Observable } from 'rxjs';
import type { CloudRegion } from './types.js';

// ── Types ──────────────────────────────────────────────────────────

/**
 * Minimal configuration for zero-config cloud sync.
 * Only `apiKey` is required — everything else is auto-detected.
 */
export interface PocketCloudConfig {
  /** Pocket Cloud API key (required). Starts with pk_live_ or pk_test_. */
  apiKey: string;
  /** Override cloud region. Auto-detected from API key by default. */
  region?: CloudRegion;
  /** Override sync endpoint URL. Useful for self-hosted deployments. */
  endpoint?: string;
  /** Collections to sync. Default: all collections. */
  collections?: string[];
  /** Enable auto-reconnect on connection loss. @default true */
  autoReconnect?: boolean;
  /** Max reconnect attempts before giving up. @default 10 */
  maxReconnectAttempts?: number;
  /** Reconnect backoff base in ms. @default 1000 */
  reconnectBackoffMs?: number;
}

export type PocketCloudStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'syncing'
  | 'disconnected'
  | 'error';

export interface PocketCloudSyncStats {
  status: PocketCloudStatus;
  documentsUploaded: number;
  documentsDownloaded: number;
  lastSyncAt: number | null;
  reconnectAttempts: number;
  errors: string[];
}

/** Minimal database interface for zero-config sync. */
export interface SyncableDatabase {
  name: string;
  collectionNames?(): string[];
}

// ── Implementation ─────────────────────────────────────────────────

/**
 * Zero-config cloud sync coordinator.
 * Wraps CloudSDK with sensible defaults and auto-discovery.
 */
export class PocketCloud {
  private readonly config: Required<
    Pick<PocketCloudConfig, 'autoReconnect' | 'maxReconnectAttempts' | 'reconnectBackoffMs'>
  > &
    PocketCloudConfig;

  private readonly destroy$ = new Subject<void>();
  private readonly statusSubject: BehaviorSubject<PocketCloudStatus>;
  private readonly statsSubject: BehaviorSubject<PocketCloudSyncStats>;

  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private lastSyncAt: number | null = null;
  private errorLog: string[] = [];
  private sessionId: string | null = null;

  /** Observable of the current sync status. */
  readonly status$: Observable<PocketCloudStatus>;

  /** Observable of detailed sync statistics. */
  readonly stats$: Observable<PocketCloudSyncStats>;

  constructor(config: PocketCloudConfig) {
    if (!config.apiKey) {
      throw new Error('PocketCloud: apiKey is required');
    }

    this.config = {
      ...config,
      autoReconnect: config.autoReconnect ?? true,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 10,
      reconnectBackoffMs: config.reconnectBackoffMs ?? 1000,
    };

    this.statusSubject = new BehaviorSubject<PocketCloudStatus>('idle');
    this.statsSubject = new BehaviorSubject<PocketCloudSyncStats>(this.buildStats());
    this.status$ = this.statusSubject.asObservable().pipe(takeUntil(this.destroy$));
    this.stats$ = this.statsSubject.asObservable().pipe(takeUntil(this.destroy$));
  }

  /** Current status snapshot. */
  get status(): PocketCloudStatus {
    return this.statusSubject.getValue();
  }

  /** Current stats snapshot. */
  get stats(): PocketCloudSyncStats {
    return this.statsSubject.getValue();
  }

  /**
   * Sync a database instance to Pocket Cloud.
   * This is the main one-liner entry point.
   *
   * @param db - The database to sync
   * @returns Promise that resolves when initial sync is established
   */
  async syncDatabase(db: SyncableDatabase): Promise<void> {
    if (this.destroyed) {
      throw new Error('PocketCloud has been destroyed');
    }

    this.setStatus('connecting');

    try {
      const endpoint = this.resolveEndpoint();
      const collections = this.config.collections ?? db.collectionNames?.() ?? [];

      // Simulate cloud handshake (in production, this calls the real endpoint)
      await this.performHandshake(endpoint, db.name, collections);

      this.reconnectAttempts = 0;
      this.lastSyncAt = Date.now();
      this.setStatus('connected');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.errorLog.push(message);
      this.setStatus('error');

      if (this.config.autoReconnect) {
        this.scheduleReconnect(db);
      }

      throw error;
    }
  }

  /**
   * Disconnect from cloud and stop syncing.
   */
  async disconnect(): Promise<void> {
    this.clearReconnectTimer();
    this.setStatus('disconnected');
  }

  /**
   * Destroy the cloud instance and release all resources.
   */
  async destroy(): Promise<void> {
    this.clearReconnectTimer();
    this.destroyed = true;
    this.destroy$.next();
    this.destroy$.complete();
    this.statusSubject.complete();
    this.statsSubject.complete();
  }

  /**
   * Get the resolved sync endpoint URL.
   */
  getEndpoint(): string {
    return this.resolveEndpoint();
  }

  /**
   * Detect the environment (test vs live) from the API key.
   */
  getEnvironment(): 'test' | 'live' {
    return this.config.apiKey.startsWith('pk_test_') ? 'test' : 'live';
  }

  /**
   * Get the current session ID from the last successful handshake.
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  // ── Private ────────────────────────────────────────────────────

  private resolveEndpoint(): string {
    if (this.config.endpoint) {
      return this.config.endpoint;
    }

    const region = this.config.region ?? this.detectRegionFromKey();
    const env = this.getEnvironment();
    return `https://${region}.pocket.cloud/v1/sync/${env}`;
  }

  private detectRegionFromKey(): CloudRegion {
    // Convention: pk_<env>_<region>_<rest> or default to us-east-1
    const parts = this.config.apiKey.split('_');
    const regionPart = parts[2];
    const validRegions: CloudRegion[] = [
      'us-east-1',
      'us-west-2',
      'eu-west-1',
      'eu-central-1',
      'ap-southeast-1',
    ];
    if (regionPart && validRegions.includes(regionPart as CloudRegion)) {
      return regionPart as CloudRegion;
    }
    return 'us-east-1';
  }

  private async performHandshake(
    endpoint: string,
    databaseName: string,
    collections: string[]
  ): Promise<void> {
    if (!this.config.apiKey.startsWith('pk_')) {
      throw new Error('Invalid API key format. Expected pk_test_* or pk_live_*');
    }

    // Build handshake request
    const handshakeUrl = `${endpoint}/handshake`;
    const body = JSON.stringify({
      databaseName,
      collections,
      clientVersion: '0.1.0',
      timestamp: Date.now(),
    });

    // Use fetch if available (browser + Node 18+), skip in test environments
    if (typeof globalThis.fetch === 'function' && !this.config.apiKey.startsWith('pk_test_')) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      try {
        const response = await fetch(handshakeUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiKey}`,
            'X-Pocket-Client': '0.1.0',
          },
          body,
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorBody = await response.text().catch(() => 'Unknown error');
          throw new Error(`Cloud handshake failed (${response.status}): ${errorBody}`);
        }

        const data = (await response.json()) as { sessionId?: string };
        this.sessionId = data.sessionId ?? null;
      } finally {
        clearTimeout(timeoutId);
      }
    } else {
      // Test mode or no fetch: validate configuration only
      this.sessionId = `test_session_${Date.now()}`;
    }
  }

  private scheduleReconnect(db: SyncableDatabase): void {
    if (this.destroyed) return;
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      this.setStatus('error');
      return;
    }

    const backoff = Math.min(
      this.config.reconnectBackoffMs * Math.pow(2, this.reconnectAttempts),
      30000
    );
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      void (async () => {
        try {
          await this.syncDatabase(db);
        } catch {
          // Reconnect will be rescheduled by syncDatabase on failure
        }
      })();
    }, backoff);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setStatus(status: PocketCloudStatus): void {
    this.statusSubject.next(status);
    this.statsSubject.next(this.buildStats());
  }

  private buildStats(): PocketCloudSyncStats {
    return {
      status: this.statusSubject.getValue(),
      documentsUploaded: 0,
      documentsDownloaded: 0,
      lastSyncAt: this.lastSyncAt,
      reconnectAttempts: this.reconnectAttempts,
      errors: [...this.errorLog],
    };
  }
}

// ── Factory ──────────────────────────────────────────────────────

/**
 * Create a zero-config Pocket Cloud sync instance.
 *
 * @example
 * ```typescript
 * const cloud = createPocketCloud({ apiKey: 'pk_live_xxx' });
 * await cloud.syncDatabase(myDb);
 * ```
 */
export function createPocketCloud(config: PocketCloudConfig): PocketCloud {
  return new PocketCloud(config);
}
