/**
 * AdaptiveSyncManager - Network-aware adaptive sync strategies.
 *
 * Adjusts batch sizes, compression, priorities, and timing
 * based on real-time network quality assessment.
 */

import { BehaviorSubject, Subject, takeUntil, type Observable } from 'rxjs';

export interface NetworkQuality {
  /** Estimated bandwidth in bytes/sec */
  bandwidthBps: number;
  /** Round-trip latency in ms */
  latencyMs: number;
  /** Connection type: wifi, cellular, ethernet, unknown */
  connectionType: 'wifi' | 'cellular' | 'ethernet' | 'unknown';
  /** Whether the device is on battery */
  onBattery: boolean;
  /** Effective connection quality */
  effectiveType: '4g' | '3g' | '2g' | 'slow-2g' | 'offline';
  /** Whether save-data mode is enabled */
  saveData: boolean;
}

export interface AdaptiveSyncConfig {
  /** Minimum batch size. @default 5 */
  minBatchSize?: number;
  /** Maximum batch size. @default 200 */
  maxBatchSize?: number;
  /** Minimum sync interval in ms. @default 1000 */
  minSyncIntervalMs?: number;
  /** Maximum sync interval in ms. @default 60000 */
  maxSyncIntervalMs?: number;
  /** Enable delta compression. @default true */
  enableCompression?: boolean;
  /** Network quality check interval in ms. @default 10000 */
  networkCheckIntervalMs?: number;
  /** Power-saving mode threshold (battery percentage). @default 20 */
  powerSaveThreshold?: number;
}

export type SyncProfile = 'aggressive' | 'balanced' | 'conservative' | 'power-save';

export interface AdaptiveSettings {
  /** Current batch size */
  batchSize: number;
  /** Current sync interval in ms */
  syncIntervalMs: number;
  /** Whether compression is enabled */
  compressionEnabled: boolean;
  /** Current sync profile */
  profile: SyncProfile;
  /** Priority order for collections (highest priority first) */
  collectionPriority: string[];
}

export interface AdaptiveSyncStats {
  /** Current network quality assessment */
  networkQuality: NetworkQuality;
  /** Current adaptive settings */
  settings: AdaptiveSettings;
  /** Total bytes saved by compression */
  bytesSavedByCompression: number;
  /** Number of profile changes */
  profileChanges: number;
  /** Average sync duration in ms */
  avgSyncDurationMs: number;
  /** Sync success rate */
  syncSuccessRate: number;
}

export interface SyncPriorityItem {
  collection: string;
  priority: number;
  lastSyncedAt: number | null;
  pendingChanges: number;
}

export class AdaptiveSyncManager {
  private readonly config: Required<AdaptiveSyncConfig>;
  private readonly destroy$ = new Subject<void>();
  private readonly networkQuality$ = new BehaviorSubject<NetworkQuality>({
    bandwidthBps: 0,
    latencyMs: 0,
    connectionType: 'unknown',
    onBattery: false,
    effectiveType: '4g',
    saveData: false,
  });
  private readonly settings$ = new BehaviorSubject<AdaptiveSettings>({
    batchSize: 50,
    syncIntervalMs: 5_000,
    compressionEnabled: true,
    profile: 'balanced',
    collectionPriority: [],
  });
  private readonly stats$ = new BehaviorSubject<AdaptiveSyncStats>({
    networkQuality: {
      bandwidthBps: 0,
      latencyMs: 0,
      connectionType: 'unknown',
      onBattery: false,
      effectiveType: '4g',
      saveData: false,
    },
    settings: {
      batchSize: 50,
      syncIntervalMs: 5_000,
      compressionEnabled: true,
      profile: 'balanced',
      collectionPriority: [],
    },
    bytesSavedByCompression: 0,
    profileChanges: 0,
    avgSyncDurationMs: 0,
    syncSuccessRate: 1,
  });

  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private syncDurations: number[] = [];
  private syncSuccesses = 0;
  private syncAttempts = 0;
  private bytesSaved = 0;
  private profileChanges = 0;
  private priorityItems = new Map<string, SyncPriorityItem>();

  constructor(config: AdaptiveSyncConfig = {}) {
    this.config = {
      minBatchSize: config.minBatchSize ?? 5,
      maxBatchSize: config.maxBatchSize ?? 200,
      minSyncIntervalMs: config.minSyncIntervalMs ?? 1_000,
      maxSyncIntervalMs: config.maxSyncIntervalMs ?? 60_000,
      enableCompression: config.enableCompression ?? true,
      networkCheckIntervalMs: config.networkCheckIntervalMs ?? 10_000,
      powerSaveThreshold: config.powerSaveThreshold ?? 20,
    };
  }

  /**
   * Start monitoring network conditions and adapting.
   */
  start(): void {
    this.assessNetwork();

    this.checkInterval = setInterval(() => {
      this.assessNetwork();
    }, this.config.networkCheckIntervalMs);
  }

  /**
   * Stop monitoring.
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Record a sync attempt for adaptive tuning.
   */
  recordSyncAttempt(options: {
    durationMs: number;
    success: boolean;
    bytesTransferred: number;
    compressedBytes?: number;
  }): void {
    this.syncAttempts++;
    if (options.success) this.syncSuccesses++;

    this.syncDurations.push(options.durationMs);
    if (this.syncDurations.length > 50) {
      this.syncDurations.shift();
    }

    if (options.compressedBytes !== undefined) {
      this.bytesSaved += options.bytesTransferred - options.compressedBytes;
    }

    this.recalculateSettings();
  }

  /**
   * Set collection sync priorities.
   */
  setPriorities(items: SyncPriorityItem[]): void {
    this.priorityItems.clear();
    for (const item of items) {
      this.priorityItems.set(item.collection, item);
    }

    const sorted = items
      .sort((a, b) => {
        // Higher priority first, then more pending changes
        if (a.priority !== b.priority) return b.priority - a.priority;
        return b.pendingChanges - a.pendingChanges;
      })
      .map((item) => item.collection);

    const current = this.settings$.getValue();
    this.settings$.next({ ...current, collectionPriority: sorted });
  }

  /**
   * Get current recommended settings.
   */
  getSettings(): Observable<AdaptiveSettings> {
    return this.settings$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /**
   * Get current settings snapshot.
   */
  getCurrentSettings(): AdaptiveSettings {
    return this.settings$.getValue();
  }

  /**
   * Get network quality observable.
   */
  getNetworkQuality(): Observable<NetworkQuality> {
    return this.networkQuality$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /**
   * Get stats observable.
   */
  getStats(): Observable<AdaptiveSyncStats> {
    return this.stats$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /**
   * Force a specific profile.
   */
  forceProfile(profile: SyncProfile): void {
    const settings = this.computeSettingsForProfile(profile);
    this.settings$.next(settings);
    this.profileChanges++;
    this.updateStats();
  }

  /**
   * Apply delta compression to a payload.
   */
  compress(data: unknown[]): { compressed: string; originalSize: number; compressedSize: number } {
    const json = JSON.stringify(data);
    const originalSize = json.length;

    // Simple delta compression: deduplicate common keys/values
    const compressed = this.applyDeltaCompression(data);
    const compressedSize = compressed.length;

    this.bytesSaved += originalSize - compressedSize;

    return { compressed, originalSize, compressedSize };
  }

  /**
   * Decompress a delta-compressed payload.
   */
  decompress(compressed: string): unknown[] {
    try {
      const parsed = JSON.parse(compressed) as { schema: string[]; rows: unknown[][] } | unknown[];
      if (Array.isArray(parsed)) return parsed;

      // Reconstruct from columnar format
      if (parsed.schema && parsed.rows) {
        return parsed.rows.map((row) => {
          const obj: Record<string, unknown> = {};
          for (let i = 0; i < parsed.schema.length; i++) {
            obj[parsed.schema[i]!] = row[i];
          }
          return obj;
        });
      }

      return [];
    } catch {
      return JSON.parse(compressed) as unknown[];
    }
  }

  destroy(): void {
    this.stop();
    this.destroy$.next();
    this.destroy$.complete();
    this.networkQuality$.complete();
    this.settings$.complete();
    this.stats$.complete();
  }

  private assessNetwork(): void {
    const quality = this.detectNetworkQuality();
    this.networkQuality$.next(quality);
    this.recalculateSettings();
  }

  private detectNetworkQuality(): NetworkQuality {
    // Use Navigator API if available
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    const connection = (nav as unknown as { connection?: { effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean; type?: string } })?.connection;

    const effectiveType = (connection?.effectiveType ?? '4g') as NetworkQuality['effectiveType'];
    const downlink = connection?.downlink ?? 10; // Mbps
    const rtt = connection?.rtt ?? 50; // ms
    const saveData = connection?.saveData ?? false;
    const connectionType = (connection?.type ?? 'unknown') as NetworkQuality['connectionType'];

    // Battery detection
    let onBattery = false;
    if (typeof navigator !== 'undefined' && 'getBattery' in navigator) {
      // Async, so we use a cached value
      onBattery = false; // Will be updated async
    }

    return {
      bandwidthBps: downlink * 1024 * 1024 / 8,
      latencyMs: rtt,
      connectionType: connectionType === 'wifi' || connectionType === 'cellular' || connectionType === 'ethernet' ? connectionType : 'unknown',
      onBattery,
      effectiveType: effectiveType === '4g' || effectiveType === '3g' || effectiveType === '2g' || effectiveType === 'slow-2g' ? effectiveType : 'offline',
      saveData,
    };
  }

  private recalculateSettings(): void {
    const quality = this.networkQuality$.getValue();
    const profile = this.determineProfile(quality);
    const settings = this.computeSettingsForProfile(profile);

    const currentProfile = this.settings$.getValue().profile;
    if (currentProfile !== profile) {
      this.profileChanges++;
    }

    this.settings$.next(settings);
    this.updateStats();
  }

  private determineProfile(quality: NetworkQuality): SyncProfile {
    if (quality.saveData || quality.onBattery) return 'power-save';
    if (quality.effectiveType === 'slow-2g' || quality.effectiveType === '2g') return 'conservative';
    if (quality.effectiveType === '3g' || quality.latencyMs > 500) return 'balanced';
    return 'aggressive';
  }

  private computeSettingsForProfile(profile: SyncProfile): AdaptiveSettings {
    const currentPriority = this.settings$.getValue().collectionPriority;

    switch (profile) {
      case 'aggressive':
        return {
          batchSize: this.config.maxBatchSize,
          syncIntervalMs: this.config.minSyncIntervalMs,
          compressionEnabled: false,
          profile,
          collectionPriority: currentPriority,
        };

      case 'balanced':
        return {
          batchSize: Math.round((this.config.minBatchSize + this.config.maxBatchSize) / 2),
          syncIntervalMs: 5_000,
          compressionEnabled: this.config.enableCompression,
          profile,
          collectionPriority: currentPriority,
        };

      case 'conservative':
        return {
          batchSize: this.config.minBatchSize * 2,
          syncIntervalMs: 30_000,
          compressionEnabled: true,
          profile,
          collectionPriority: currentPriority,
        };

      case 'power-save':
        return {
          batchSize: this.config.minBatchSize,
          syncIntervalMs: this.config.maxSyncIntervalMs,
          compressionEnabled: true,
          profile,
          collectionPriority: currentPriority,
        };
    }
  }

  private applyDeltaCompression(data: unknown[]): string {
    if (data.length === 0) return '[]';
    if (data.length < 3) return JSON.stringify(data);

    // Columnar compression: extract common schema
    const firstItem = data[0] as Record<string, unknown>;
    if (typeof firstItem !== 'object' || firstItem === null) {
      return JSON.stringify(data);
    }

    const schema = Object.keys(firstItem);
    const rows = data.map((item) => {
      const obj = item as Record<string, unknown>;
      return schema.map((key) => obj[key]);
    });

    return JSON.stringify({ schema, rows });
  }

  private updateStats(): void {
    const avgDuration = this.syncDurations.length > 0
      ? this.syncDurations.reduce((a, b) => a + b, 0) / this.syncDurations.length
      : 0;

    this.stats$.next({
      networkQuality: this.networkQuality$.getValue(),
      settings: this.settings$.getValue(),
      bytesSavedByCompression: this.bytesSaved,
      profileChanges: this.profileChanges,
      avgSyncDurationMs: Math.round(avgDuration),
      syncSuccessRate: this.syncAttempts > 0 ? this.syncSuccesses / this.syncAttempts : 1,
    });
  }
}

export function createAdaptiveSyncManager(config?: AdaptiveSyncConfig): AdaptiveSyncManager {
  return new AdaptiveSyncManager(config);
}
