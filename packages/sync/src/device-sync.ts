/**
 * DeviceSyncManager - Multi-device sync management.
 *
 * Manages device registration, selective sync rules,
 * and per-device sync status tracking.
 */

import { BehaviorSubject, Subject, takeUntil, type Observable } from 'rxjs';

export interface DeviceCapabilities {
  hasWifi: boolean;
  hasCellular: boolean;
  storageQuotaMB: number;
  batteryLevel?: number;
}

export interface DeviceInfo {
  id: string;
  name: string;
  platform: 'web' | 'mobile' | 'desktop' | 'tablet';
  capabilities: DeviceCapabilities;
  lastSeen: number;
  isOnline: boolean;
}

export interface SyncRule {
  collection: string;
  condition: 'always' | 'wifi-only' | 'manual' | 'starred-only';
  priority: number;
  maxDocuments?: number;
}

export interface DeviceSyncConfig {
  deviceId: string;
  deviceName: string;
  platform: DeviceInfo['platform'];
  rules?: SyncRule[];
  syncIntervalMs?: number;
  bandwidthLimitKBps?: number;
}

export interface DeviceSyncStats {
  registeredDevices: number;
  activeDevices: number;
  lastSyncPerDevice: Map<string, number>;
  pendingSyncs: number;
}

export class DeviceSyncManager {
  private readonly destroy$ = new Subject<void>();
  private readonly devicesSubject$ = new BehaviorSubject<DeviceInfo[]>([]);
  private readonly devices = new Map<string, DeviceInfo>();
  private readonly rules = new Map<string, SyncRule>();
  private readonly lastSyncPerDevice = new Map<string, number>();
  private pendingSyncs = 0;

  /** Observable stream of device state changes. */
  readonly devices$: Observable<DeviceInfo[]>;

  constructor(config: DeviceSyncConfig) {
    this.devices$ = this.devicesSubject$.asObservable().pipe(takeUntil(this.destroy$));

    if (config.rules) {
      for (const rule of config.rules) {
        this.rules.set(rule.collection, rule);
      }
    }
  }

  registerDevice(info: DeviceInfo): void {
    this.devices.set(info.id, info);
    this.emitDevices();
  }

  removeDevice(deviceId: string): void {
    this.devices.delete(deviceId);
    this.lastSyncPerDevice.delete(deviceId);
    this.emitDevices();
  }

  getDevices(): DeviceInfo[] {
    return Array.from(this.devices.values());
  }

  getDevice(deviceId: string): DeviceInfo | undefined {
    return this.devices.get(deviceId);
  }

  updateDeviceStatus(deviceId: string, online: boolean, capabilities?: DeviceCapabilities): void {
    const device = this.devices.get(deviceId);
    if (!device) return;

    const updated: DeviceInfo = {
      ...device,
      isOnline: online,
      lastSeen: Date.now(),
      ...(capabilities ? { capabilities } : {}),
    };
    this.devices.set(deviceId, updated);
    this.emitDevices();
  }

  addSyncRule(rule: SyncRule): void {
    this.rules.set(rule.collection, rule);
  }

  removeSyncRule(collection: string): void {
    this.rules.delete(collection);
  }

  getSyncRules(): SyncRule[] {
    return Array.from(this.rules.values());
  }

  shouldSync(collection: string, deviceId: string): boolean {
    const rule = this.rules.get(collection);
    if (!rule) return true;

    const device = this.devices.get(deviceId);
    if (!device) return false;

    switch (rule.condition) {
      case 'always':
        return true;
      case 'wifi-only':
        return device.capabilities.hasWifi;
      case 'manual':
        return false;
      case 'starred-only':
        return true;
      default:
        return true;
    }
  }

  getStats(): DeviceSyncStats {
    const allDevices = Array.from(this.devices.values());
    return {
      registeredDevices: allDevices.length,
      activeDevices: allDevices.filter((d) => d.isOnline).length,
      lastSyncPerDevice: new Map(this.lastSyncPerDevice),
      pendingSyncs: this.pendingSyncs,
    };
  }

  dispose(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.devicesSubject$.complete();
    this.devices.clear();
    this.rules.clear();
  }

  private emitDevices(): void {
    this.devicesSubject$.next(Array.from(this.devices.values()));
  }
}

export function createDeviceSyncManager(config: DeviceSyncConfig): DeviceSyncManager {
  return new DeviceSyncManager(config);
}
