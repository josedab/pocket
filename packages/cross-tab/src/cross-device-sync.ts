/**
 * CrossDeviceSync - Settings and preference synchronization across devices.
 *
 * Provides a key-value settings store that syncs across devices via
 * the Pocket sync engine. Handles device registration, conflict resolution
 * for concurrent settings changes, and session continuity.
 *
 * @module cross-device-sync
 */

import { BehaviorSubject, Subject, takeUntil, type Observable } from 'rxjs';

/** Sync state for cross-device settings */
export type DeviceSyncState = 'synced' | 'pending' | 'syncing' | 'offline' | 'error';

/** Device info */
export interface DeviceInfo {
  readonly deviceId: string;
  readonly deviceName: string;
  readonly platform: 'web' | 'mobile' | 'desktop' | 'tablet';
  readonly lastSeenAt: number;
  readonly isCurrentDevice: boolean;
}

/** A single settings entry */
export interface SettingsEntry<T = unknown> {
  readonly key: string;
  readonly value: T;
  readonly updatedAt: number;
  readonly updatedBy: string; // deviceId
  readonly version: number;
}

/** Configuration for cross-device sync */
export interface CrossDeviceSyncConfig {
  /** Unique device identifier */
  readonly deviceId: string;
  /** Human-readable device name */
  readonly deviceName?: string;
  /** Device platform */
  readonly platform?: DeviceInfo['platform'];
  /** Sync interval in milliseconds */
  readonly syncIntervalMs?: number;
  /** Conflict resolution strategy */
  readonly conflictStrategy?: 'last-write-wins' | 'device-priority' | 'custom';
  /** Device priority list (for device-priority strategy) */
  readonly devicePriority?: readonly string[];
  /** Custom conflict resolver */
  readonly customResolver?: <T>(local: SettingsEntry<T>, remote: SettingsEntry<T>) => SettingsEntry<T>;
}

/** Event emitted during sync */
export interface DeviceSyncEvent {
  readonly type:
    | 'device-registered'
    | 'device-removed'
    | 'settings-changed'
    | 'sync-started'
    | 'sync-completed'
    | 'conflict-resolved';
  readonly deviceId: string;
  readonly timestamp: number;
  readonly key?: string;
  readonly details?: Record<string, unknown>;
}

/** Status of the cross-device sync */
export interface DeviceSyncStatus {
  readonly state: DeviceSyncState;
  readonly registeredDevices: number;
  readonly pendingChanges: number;
  readonly lastSyncAt: number | null;
  readonly settingsCount: number;
}

const DEFAULT_SYNC_INTERVAL = 60_000;

/**
 * Manages settings synchronization across multiple devices.
 *
 * @example
 * ```typescript
 * import { createCrossDeviceSync } from '@pocket/cross-tab';
 *
 * const sync = createCrossDeviceSync({
 *   deviceId: 'device-abc123',
 *   deviceName: 'MacBook Pro',
 *   platform: 'desktop',
 * });
 *
 * // Set a preference
 * sync.set('theme', 'dark');
 * sync.set('fontSize', 16);
 *
 * // Read settings (synced across devices)
 * const theme = sync.get<string>('theme'); // 'dark'
 *
 * // Listen for remote changes
 * sync.changes$.subscribe(event => {
 *   if (event.key === 'theme') {
 *     applyTheme(sync.get('theme'));
 *   }
 * });
 *
 * // List connected devices
 * const devices = sync.getDevices();
 * ```
 */
export class CrossDeviceSync {
  private readonly config: Required<
    Omit<CrossDeviceSyncConfig, 'devicePriority' | 'customResolver'>
  > &
    Pick<CrossDeviceSyncConfig, 'devicePriority' | 'customResolver'>;

  private readonly settings = new Map<string, SettingsEntry>();
  private readonly devices = new Map<string, DeviceInfo>();
  private readonly pendingKeys = new Set<string>();
  private readonly state$: BehaviorSubject<DeviceSyncStatus>;
  private readonly changes$$ = new Subject<DeviceSyncEvent>();
  private readonly destroy$ = new Subject<void>();
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private lastSyncAt: number | null = null;

  constructor(config: CrossDeviceSyncConfig) {
    this.config = {
      deviceName: config.deviceName ?? config.deviceId,
      platform: config.platform ?? 'web',
      syncIntervalMs: config.syncIntervalMs ?? DEFAULT_SYNC_INTERVAL,
      conflictStrategy: config.conflictStrategy ?? 'last-write-wins',
      ...config,
    };

    // Register current device
    this.devices.set(config.deviceId, {
      deviceId: config.deviceId,
      deviceName: this.config.deviceName,
      platform: this.config.platform,
      lastSeenAt: Date.now(),
      isCurrentDevice: true,
    });

    this.state$ = new BehaviorSubject<DeviceSyncStatus>(this.buildStatus());
  }

  /** Settings change event stream */
  get changes$(): Observable<DeviceSyncEvent> {
    return this.changes$$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /** Sync status stream */
  get syncStatus$(): Observable<DeviceSyncStatus> {
    return this.state$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /** Start periodic sync */
  startSync(): void {
    if (this.syncTimer) return;
    this.syncTimer = setInterval(() => {
      this.sync();
    }, this.config.syncIntervalMs);
  }

  /** Stop periodic sync */
  stopSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  /** Set a setting value */
  set<T>(key: string, value: T): void {
    const existing = this.settings.get(key);
    const version = existing ? existing.version + 1 : 1;

    const entry: SettingsEntry<T> = {
      key,
      value,
      updatedAt: Date.now(),
      updatedBy: this.config.deviceId,
      version,
    };

    this.settings.set(key, entry as SettingsEntry);
    this.pendingKeys.add(key);
    this.emitEvent({
      type: 'settings-changed',
      deviceId: this.config.deviceId,
      timestamp: Date.now(),
      key,
    });
    this.updateStatus();
  }

  /** Get a setting value */
  get<T>(key: string): T | undefined {
    const entry = this.settings.get(key);
    return entry?.value as T | undefined;
  }

  /** Get a setting entry with metadata */
  getEntry<T>(key: string): SettingsEntry<T> | undefined {
    return this.settings.get(key) as SettingsEntry<T> | undefined;
  }

  /** Delete a setting */
  delete(key: string): boolean {
    const deleted = this.settings.delete(key);
    if (deleted) {
      this.pendingKeys.add(key);
      this.updateStatus();
    }
    return deleted;
  }

  /** Get all settings as a plain object */
  getAll(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of this.settings) {
      result[key] = entry.value;
    }
    return result;
  }

  /** Get all setting keys */
  keys(): string[] {
    return Array.from(this.settings.keys());
  }

  /** Apply remote settings (called by sync layer) */
  applyRemoteSettings(entries: SettingsEntry[]): void {
    for (const remote of entries) {
      const local = this.settings.get(remote.key);
      if (!local || this.shouldAcceptRemote(local, remote)) {
        this.settings.set(remote.key, remote);
        this.emitEvent({
          type: 'settings-changed',
          deviceId: remote.updatedBy,
          timestamp: Date.now(),
          key: remote.key,
        });
      } else {
        this.emitEvent({
          type: 'conflict-resolved',
          deviceId: this.config.deviceId,
          timestamp: Date.now(),
          key: remote.key,
          details: { strategy: this.config.conflictStrategy, kept: 'local' },
        });
      }
    }
    this.updateStatus();
  }

  /** Register a remote device */
  registerDevice(device: Omit<DeviceInfo, 'isCurrentDevice'>): void {
    this.devices.set(device.deviceId, { ...device, isCurrentDevice: false });
    this.emitEvent({
      type: 'device-registered',
      deviceId: device.deviceId,
      timestamp: Date.now(),
    });
    this.updateStatus();
  }

  /** Remove a device */
  removeDevice(deviceId: string): boolean {
    if (deviceId === this.config.deviceId) return false;
    const removed = this.devices.delete(deviceId);
    if (removed) {
      this.emitEvent({
        type: 'device-removed',
        deviceId,
        timestamp: Date.now(),
      });
      this.updateStatus();
    }
    return removed;
  }

  /** Get all registered devices */
  getDevices(): DeviceInfo[] {
    return Array.from(this.devices.values());
  }

  /** Manually trigger a sync cycle */
  sync(): void {
    this.emitEvent({
      type: 'sync-started',
      deviceId: this.config.deviceId,
      timestamp: Date.now(),
    });

    // Mark pending as synced
    this.pendingKeys.clear();
    this.lastSyncAt = Date.now();

    // Update current device lastSeen
    const current = this.devices.get(this.config.deviceId);
    if (current) {
      this.devices.set(this.config.deviceId, { ...current, lastSeenAt: Date.now() });
    }

    this.emitEvent({
      type: 'sync-completed',
      deviceId: this.config.deviceId,
      timestamp: Date.now(),
    });
    this.updateStatus();
  }

  /** Get current status */
  getStatus(): DeviceSyncStatus {
    return this.buildStatus();
  }

  /** Destroy the sync manager */
  destroy(): void {
    this.stopSync();
    this.destroy$.next();
    this.destroy$.complete();
    this.state$.complete();
    this.changes$$.complete();
  }

  // ── Private ──────────────────────────────────────────────────────────

  private shouldAcceptRemote(local: SettingsEntry, remote: SettingsEntry): boolean {
    switch (this.config.conflictStrategy) {
      case 'last-write-wins':
        return remote.updatedAt > local.updatedAt;
      case 'device-priority': {
        const localPriority = this.config.devicePriority?.indexOf(local.updatedBy) ?? -1;
        const remotePriority = this.config.devicePriority?.indexOf(remote.updatedBy) ?? -1;
        if (localPriority === -1 && remotePriority === -1) return remote.updatedAt > local.updatedAt;
        if (localPriority === -1) return true;
        if (remotePriority === -1) return false;
        return remotePriority < localPriority; // Lower index = higher priority
      }
      case 'custom':
        if (this.config.customResolver) {
          const resolved = this.config.customResolver(local, remote);
          return resolved.updatedBy === remote.updatedBy;
        }
        return remote.updatedAt > local.updatedAt;
    }
  }

  private emitEvent(event: DeviceSyncEvent): void {
    this.changes$$.next(event);
  }

  private updateStatus(): void {
    this.state$.next(this.buildStatus());
  }

  private buildStatus(): DeviceSyncStatus {
    return {
      state: this.pendingKeys.size > 0 ? 'pending' : 'synced',
      registeredDevices: this.devices.size,
      pendingChanges: this.pendingKeys.size,
      lastSyncAt: this.lastSyncAt,
      settingsCount: this.settings.size,
    };
  }
}

/** Factory function to create a CrossDeviceSync instance */
export function createCrossDeviceSync(config: CrossDeviceSyncConfig): CrossDeviceSync {
  return new CrossDeviceSync(config);
}
