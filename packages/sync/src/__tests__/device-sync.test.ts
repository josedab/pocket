import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  DeviceSyncManager,
  createDeviceSyncManager,
  type DeviceInfo,
  type DeviceCapabilities,
  type SyncRule,
} from '../device-sync.js';

function makeDevice(overrides: Partial<DeviceInfo> = {}): DeviceInfo {
  return {
    id: 'device-1',
    name: 'Test Device',
    platform: 'desktop',
    capabilities: { hasWifi: true, hasCellular: false, storageQuotaMB: 1024 },
    lastSeen: Date.now(),
    isOnline: true,
    ...overrides,
  };
}

describe('DeviceSyncManager', () => {
  let manager: DeviceSyncManager;

  beforeEach(() => {
    manager = createDeviceSyncManager({
      deviceId: 'local',
      deviceName: 'Local',
      platform: 'desktop',
    });
  });

  afterEach(() => {
    manager.dispose();
  });

  describe('device registration', () => {
    it('should register and list devices', () => {
      const d1 = makeDevice({ id: 'd1', name: 'Desktop' });
      const d2 = makeDevice({ id: 'd2', name: 'Phone', platform: 'mobile' });

      manager.registerDevice(d1);
      manager.registerDevice(d2);

      const devices = manager.getDevices();
      expect(devices).toHaveLength(2);
      expect(devices.map((d) => d.id)).toContain('d1');
      expect(devices.map((d) => d.id)).toContain('d2');
    });

    it('should remove a device', () => {
      const d1 = makeDevice({ id: 'd1' });
      manager.registerDevice(d1);
      expect(manager.getDevices()).toHaveLength(1);

      manager.removeDevice('d1');
      expect(manager.getDevices()).toHaveLength(0);
      expect(manager.getDevice('d1')).toBeUndefined();
    });

    it('should retrieve a single device by id', () => {
      const d1 = makeDevice({ id: 'd1', name: 'My Laptop' });
      manager.registerDevice(d1);

      expect(manager.getDevice('d1')?.name).toBe('My Laptop');
      expect(manager.getDevice('nonexistent')).toBeUndefined();
    });
  });

  describe('device status updates', () => {
    it('should update online status', () => {
      manager.registerDevice(makeDevice({ id: 'd1', isOnline: true }));
      manager.updateDeviceStatus('d1', false);

      expect(manager.getDevice('d1')?.isOnline).toBe(false);
    });

    it('should update capabilities when provided', () => {
      manager.registerDevice(makeDevice({ id: 'd1' }));

      const newCaps: DeviceCapabilities = {
        hasWifi: false,
        hasCellular: true,
        storageQuotaMB: 512,
        batteryLevel: 45,
      };
      manager.updateDeviceStatus('d1', true, newCaps);

      const device = manager.getDevice('d1')!;
      expect(device.capabilities.hasWifi).toBe(false);
      expect(device.capabilities.hasCellular).toBe(true);
      expect(device.capabilities.batteryLevel).toBe(45);
    });

    it('should ignore updates for unknown devices', () => {
      manager.updateDeviceStatus('unknown', true);
      expect(manager.getDevices()).toHaveLength(0);
    });
  });

  describe('sync rules', () => {
    it('should add and list rules', () => {
      const rule: SyncRule = { collection: 'notes', condition: 'always', priority: 1 };
      manager.addSyncRule(rule);

      const rules = manager.getSyncRules();
      expect(rules).toHaveLength(1);
      expect(rules[0]!.collection).toBe('notes');
    });

    it('should remove a rule by collection', () => {
      manager.addSyncRule({ collection: 'notes', condition: 'always', priority: 1 });
      manager.addSyncRule({ collection: 'todos', condition: 'manual', priority: 2 });

      manager.removeSyncRule('notes');
      expect(manager.getSyncRules()).toHaveLength(1);
      expect(manager.getSyncRules()[0]!.collection).toBe('todos');
    });

    it('should accept initial rules via config', () => {
      const m = createDeviceSyncManager({
        deviceId: 'x',
        deviceName: 'X',
        platform: 'web',
        rules: [
          { collection: 'a', condition: 'always', priority: 1 },
          { collection: 'b', condition: 'manual', priority: 2 },
        ],
      });
      expect(m.getSyncRules()).toHaveLength(2);
      m.dispose();
    });
  });

  describe('shouldSync', () => {
    it('should return true for always condition', () => {
      manager.registerDevice(makeDevice({ id: 'd1' }));
      manager.addSyncRule({ collection: 'notes', condition: 'always', priority: 1 });

      expect(manager.shouldSync('notes', 'd1')).toBe(true);
    });

    it('should return true for wifi-only when device has wifi', () => {
      manager.registerDevice(
        makeDevice({ id: 'd1', capabilities: { hasWifi: true, hasCellular: false, storageQuotaMB: 1024 } }),
      );
      manager.addSyncRule({ collection: 'photos', condition: 'wifi-only', priority: 1 });

      expect(manager.shouldSync('photos', 'd1')).toBe(true);
    });

    it('should return false for wifi-only when device has no wifi', () => {
      manager.registerDevice(
        makeDevice({ id: 'd1', capabilities: { hasWifi: false, hasCellular: true, storageQuotaMB: 256 } }),
      );
      manager.addSyncRule({ collection: 'photos', condition: 'wifi-only', priority: 1 });

      expect(manager.shouldSync('photos', 'd1')).toBe(false);
    });

    it('should return false for manual condition', () => {
      manager.registerDevice(makeDevice({ id: 'd1' }));
      manager.addSyncRule({ collection: 'archive', condition: 'manual', priority: 1 });

      expect(manager.shouldSync('archive', 'd1')).toBe(false);
    });

    it('should return true when no rule exists for collection', () => {
      manager.registerDevice(makeDevice({ id: 'd1' }));

      expect(manager.shouldSync('unknown-collection', 'd1')).toBe(true);
    });

    it('should return false for unknown device', () => {
      manager.addSyncRule({ collection: 'notes', condition: 'always', priority: 1 });

      expect(manager.shouldSync('notes', 'nonexistent')).toBe(false);
    });
  });

  describe('stats', () => {
    it('should track registered and active devices', () => {
      manager.registerDevice(makeDevice({ id: 'd1', isOnline: true }));
      manager.registerDevice(makeDevice({ id: 'd2', isOnline: false }));
      manager.registerDevice(makeDevice({ id: 'd3', isOnline: true }));

      const stats = manager.getStats();
      expect(stats.registeredDevices).toBe(3);
      expect(stats.activeDevices).toBe(2);
    });

    it('should return empty stats when no devices', () => {
      const stats = manager.getStats();
      expect(stats.registeredDevices).toBe(0);
      expect(stats.activeDevices).toBe(0);
      expect(stats.pendingSyncs).toBe(0);
    });
  });

  describe('devices$ observable', () => {
    it('should emit on device registration', () => {
      const emissions: DeviceInfo[][] = [];
      const sub = manager.devices$.subscribe((devices) => emissions.push(devices));

      manager.registerDevice(makeDevice({ id: 'd1' }));
      manager.registerDevice(makeDevice({ id: 'd2' }));

      // BehaviorSubject emits initial [] + 2 registrations
      expect(emissions).toHaveLength(3);
      expect(emissions[0]).toHaveLength(0);
      expect(emissions[1]).toHaveLength(1);
      expect(emissions[2]).toHaveLength(2);

      sub.unsubscribe();
    });

    it('should emit on device removal', () => {
      manager.registerDevice(makeDevice({ id: 'd1' }));

      const emissions: DeviceInfo[][] = [];
      const sub = manager.devices$.subscribe((devices) => emissions.push(devices));

      manager.removeDevice('d1');

      // BehaviorSubject emits current [d1] + removal []
      expect(emissions).toHaveLength(2);
      expect(emissions[1]).toHaveLength(0);

      sub.unsubscribe();
    });

    it('should emit on status update', () => {
      manager.registerDevice(makeDevice({ id: 'd1', isOnline: true }));

      const emissions: DeviceInfo[][] = [];
      const sub = manager.devices$.subscribe((devices) => emissions.push(devices));

      manager.updateDeviceStatus('d1', false);

      expect(emissions).toHaveLength(2);
      expect(emissions[1]![0]!.isOnline).toBe(false);

      sub.unsubscribe();
    });
  });
});
